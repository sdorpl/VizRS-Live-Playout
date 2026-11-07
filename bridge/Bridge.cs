// VizRS Bridge – ogólny dyspozytor komend ErsatzTV legacy.
//
// Wpięcie bez zmiany kodu legacy:
//   DOTNET_STARTUP_HOOKS=/vizrs-bridge/VizRS.Bridge.dll       -> StartupHook.Initialize (rozwiązywanie zestawów)
//   ASPNETCORE_HOSTINGSTARTUPASSEMBLIES=VizRS.Bridge          -> BridgeHostingStartup (oprogramowanie pośrednie)
//
// API (wszystko pod /vizrs-bridge/, nagłówek X-VizRS-Token = VIZRS_BRIDGE_TOKEN):
//   GET  /vizrs-bridge/health            stan mostu i legacy
//   GET  /vizrs-bridge/commands          dozwolone komendy z parametrami
//   POST /vizrs-bridge/command/{Nazwa}   argumenty komendy w JSON -> {"ok":true,"result":…} | {"ok":false,"error":…}
//   POST /vizrs-bridge/upload/{Rodzaj}    obraz (Logo|Watermark, treść = bajty pliku) -> SaveArtworkToDisk -> {"ok":true,"result":"<nazwa w pamięci legacy>"}
//
// Biała lista: plik VIZRS_BRIDGE_COMMANDS (domyślnie commands.txt obok DLL). Komendy spoza listy -> 403.

using System.Collections.Concurrent;
using System.Reflection;
using System.Runtime.Loader;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

[assembly: HostingStartup(typeof(VizRS.Bridge.BridgeHostingStartup))]

/// <summary>Hak startowy .NET: pozwala znaleźć VizRS.Bridge po nazwie, choć nie ma go w ErsatzTV.deps.json.</summary>
internal static class StartupHook
{
    public static void Initialize()
    {
        string? dir = Path.GetDirectoryName(typeof(StartupHook).Assembly.Location);
        if (dir is null)
        {
            return;
        }

        AssemblyLoadContext.Default.Resolving += (ctx, name) =>
        {
            if (name.Name is null || !name.Name.StartsWith("VizRS.", StringComparison.Ordinal))
            {
                return null;
            }

            string path = Path.Combine(dir, name.Name + ".dll");
            return File.Exists(path) ? ctx.LoadFromAssemblyPath(path) : null;
        };
    }
}

namespace VizRS.Bridge
{
    public sealed class BridgeHostingStartup : IHostingStartup
    {
        public void Configure(IWebHostBuilder builder) =>
            builder.ConfigureServices(services => services.AddTransient<IStartupFilter, BridgeStartupFilter>());
    }

    internal sealed class BridgeStartupFilter : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            app.UseMiddleware<BridgeMiddleware>();
            next(app);
        };
    }

    internal sealed class BridgeMiddleware
    {
        private const string Prefix = "/vizrs-bridge";
        private const int MaxBody = 1 << 20;
        private const int MaxUpload = 10 << 20;
        private static readonly string[] UploadKinds = ["Logo", "Watermark"];
        public const string Version = "1.2.0";

        private readonly RequestDelegate _next;
        private readonly byte[]? _token;
        private readonly Registry _registry;

        public BridgeMiddleware(RequestDelegate next)
        {
            _next = next;
            string? token = Environment.GetEnvironmentVariable("VIZRS_BRIDGE_TOKEN");
            _token = string.IsNullOrWhiteSpace(token) || token.Length < 16 ? null : Encoding.UTF8.GetBytes(token);
            _registry = Registry.Load();
            Console.WriteLine(
                _token is null
                    ? "[vizrs-bridge] wyłączony: brak VIZRS_BRIDGE_TOKEN (min. 16 znaków)"
                    : $"[vizrs-bridge] {Version} gotowy: {_registry.Allowed.Count} dozwolonych komend, {_registry.Missing.Count} nieznanych w tej wersji legacy");
        }

        public async Task InvokeAsync(HttpContext ctx)
        {
            PathString path = ctx.Request.Path;
            if (!path.StartsWithSegments(Prefix, StringComparison.Ordinal, out PathString rest))
            {
                await _next(ctx);
                return;
            }

            if (_token is null)
            {
                await Json(ctx, 503, new { ok = false, error = "most wyłączony: ustaw VIZRS_BRIDGE_TOKEN (min. 16 znaków)" });
                return;
            }

            byte[] given = Encoding.UTF8.GetBytes(ctx.Request.Headers["X-VizRS-Token"].ToString());
            if (!CryptographicOperations.FixedTimeEquals(given, _token))
            {
                await Task.Delay(250);
                await Json(ctx, 401, new { ok = false, error = "zły token mostu" });
                return;
            }

            string r = rest.Value ?? string.Empty;
            try
            {
                if (r == "/health" && HttpMethods.IsGet(ctx.Request.Method))
                {
                    await Json(ctx, 200, Health());
                }
                else if (r == "/commands" && HttpMethods.IsGet(ctx.Request.Method))
                {
                    await Json(ctx, 200, new { ok = true, result = _registry.Describe() });
                }
                else if (r.StartsWith("/command/", StringComparison.Ordinal) && HttpMethods.IsPost(ctx.Request.Method))
                {
                    await Command(ctx, r["/command/".Length..]);
                }
                else if (r.StartsWith("/upload/", StringComparison.Ordinal) && HttpMethods.IsPost(ctx.Request.Method))
                {
                    await Upload(ctx, r["/upload/".Length..]);
                }
                else
                {
                    await Json(ctx, 404, new { ok = false, error = "nieznany adres mostu" });
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[vizrs-bridge] błąd {r}: {ex}");
                if (!ctx.Response.HasStarted)
                {
                    await Json(ctx, 500, new { ok = false, error = Inner(ex).Message });
                }
            }
        }

        private object Health()
        {
            Assembly? entry = Assembly.GetEntryAssembly();
            string legacy = entry?.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "?";
            return new
            {
                ok = true,
                result = new
                {
                    bridge = Version,
                    legacy,
                    commandsAllowed = _registry.Allowed.Count,
                    commandsMissing = _registry.Missing,
                    commandsKnown = _registry.KnownCount,
                },
            };
        }

        private async Task Command(HttpContext ctx, string name)
        {
            if (!_registry.Allowed.TryGetValue(name, out Type? type))
            {
                await Json(ctx, 403, new { ok = false, error = $"komenda '{name}' nie jest dozwolona (biała lista mostu)" });
                return;
            }

            if (ctx.Request.ContentLength is > MaxBody)
            {
                await Json(ctx, 413, new { ok = false, error = "za duże argumenty" });
                return;
            }

            JsonElement args;
            using (var ms = new MemoryStream())
            {
                await ctx.Request.Body.CopyToAsync(ms);
                if (ms.Length > MaxBody)
                {
                    await Json(ctx, 413, new { ok = false, error = "za duże argumenty" });
                    return;
                }

                if (ms.Length == 0)
                {
                    args = JsonDocument.Parse("{}").RootElement;
                }
                else
                {
                    try
                    {
                        args = JsonDocument.Parse(ms.ToArray(), new JsonDocumentOptions { MaxDepth = 32 }).RootElement;
                    }
                    catch (JsonException e)
                    {
                        await Json(ctx, 400, new { ok = false, error = "argumenty to nie JSON: " + e.Message });
                        return;
                    }
                }
            }

            if (args.ValueKind != JsonValueKind.Object)
            {
                await Json(ctx, 400, new { ok = false, error = "argumenty muszą być obiektem JSON" });
                return;
            }

            object request;
            try
            {
                request = Binder.Bind(type, args);
            }
            catch (Exception e)
            {
                await Json(ctx, 400, new { ok = false, error = $"złe argumenty {name}: {Inner(e).Message}" });
                return;
            }

            // Zadania w tle (np. BuildPlayout) legacy wysyła do kolejki, nie przez MediatR – robimy tak samo.
            if (TryQueue(ctx.RequestServices, request, out string? queue))
            {
                Console.WriteLine($"[vizrs-bridge] {name} -> kolejka {queue}");
                await Json(ctx, 202, new { ok = true, queued = queue });
                return;
            }

            var sender = ctx.RequestServices.GetRequiredService<ISender>();
            object? result = await sender.Send(request, ctx.RequestAborted);
            Console.WriteLine($"[vizrs-bridge] {name}");

            // Komenda już się wykonała. Część wyników legacy to leniwe projekcje, których jego UI nie czyta
            // (np. ReplaceProgramScheduleItems) – gdy nie dają się zserializować, zgłaszamy sukces z ostrzeżeniem.
            byte[] body;
            try
            {
                body = JsonSerializer.SerializeToUtf8Bytes(Results.Unwrap(result), Binder.Options);
            }
            catch (Exception e)
            {
                Console.WriteLine($"[vizrs-bridge] {name}: wynik nieczytelny: {Inner(e).Message}");
                body = JsonSerializer.SerializeToUtf8Bytes(
                    new { ok = true, result = (object?)null, warning = "komenda wykonana, ale legacy zwrócił wynik, którego nie da się odczytać: " + Inner(e).Message },
                    Binder.Options);
            }

            await Raw(ctx, 200, body);
        }

        /// <summary>
        /// Wgranie obrazu: SaveArtworkToDisk przyjmuje Stream, więc nie przejdzie przez ogólny dyspozytor JSON.
        /// Tylko obrazy PNG/JPEG/GIF/WebP (typ i sygnatura pliku), do 10 MB, rodzaje Logo i Watermark.
        /// </summary>
        private async Task Upload(HttpContext ctx, string kind)
        {
            if (!_registry.Allowed.TryGetValue("SaveArtworkToDisk", out Type? type))
            {
                await Json(ctx, 403, new { ok = false, error = "komenda 'SaveArtworkToDisk' nie jest dozwolona (biała lista mostu)" });
                return;
            }

            if (!UploadKinds.Contains(kind, StringComparer.Ordinal))
            {
                await Json(ctx, 400, new { ok = false, error = "rodzaj obrazu: Logo albo Watermark" });
                return;
            }

            string ct = (ctx.Request.ContentType ?? string.Empty).Split(';')[0].Trim().ToLowerInvariant();
            if (ctx.Request.ContentLength is > MaxUpload)
            {
                await Json(ctx, 413, new { ok = false, error = "obraz większy niż 10 MB" });
                return;
            }

            using var ms = new MemoryStream();
            byte[] buf = new byte[81920];
            int n;
            while ((n = await ctx.Request.Body.ReadAsync(buf, ctx.RequestAborted)) > 0)
            {
                if (ms.Length + n > MaxUpload)
                {
                    await Json(ctx, 413, new { ok = false, error = "obraz większy niż 10 MB" });
                    return;
                }

                ms.Write(buf, 0, n);
            }

            if (!ImageMatches(ct, ms.GetBuffer().AsSpan(0, (int)ms.Length)))
            {
                await Json(ctx, 415, new { ok = false, error = "dozwolone tylko obrazy PNG, JPEG, GIF i WebP (typ i treść pliku muszą się zgadzać)" });
                return;
            }

            ConstructorInfo ctor = Binder.Constructor(type) ?? throw new InvalidOperationException("SaveArtworkToDisk bez konstruktora");
            ParameterInfo[] ps = ctor.GetParameters();
            if (ps.Length != 3 || ps[0].ParameterType != typeof(Stream) || !ps[1].ParameterType.IsEnum)
            {
                await Json(ctx, 500, new { ok = false, error = "SaveArtworkToDisk ma w tej wersji legacy inne pola" });
                return;
            }

            ms.Position = 0;
            object request = ctor.Invoke([ms, Enum.Parse(ps[1].ParameterType, kind), ct]);
            var sender = ctx.RequestServices.GetRequiredService<ISender>();
            object? result = await sender.Send(request, ctx.RequestAborted);
            Console.WriteLine($"[vizrs-bridge] upload {kind} {ct} {ms.Length} B");
            await Json(ctx, 200, Results.Unwrap(result));
        }

        /// <summary>Typ zawartości obrazu zgodny z sygnaturą pliku.</summary>
        internal static bool ImageMatches(string ct, ReadOnlySpan<byte> b) => ct switch
        {
            "image/png" => b.StartsWith((ReadOnlySpan<byte>)[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
            "image/jpeg" => b.StartsWith((ReadOnlySpan<byte>)[0xFF, 0xD8, 0xFF]),
            "image/gif" => b.StartsWith("GIF87a"u8) || b.StartsWith("GIF89a"u8),
            "image/webp" => b.Length >= 12 && b.StartsWith("RIFF"u8) && b[8..12].SequenceEqual("WEBP"u8),
            _ => false,
        };

        private static bool TryQueue(IServiceProvider services, object request, out string? queue)
        {
            foreach (Type iface in request.GetType().GetInterfaces())
            {
                if (iface.Namespace?.StartsWith("MediatR", StringComparison.Ordinal) == true || !iface.Name.EndsWith("Request", StringComparison.Ordinal))
                {
                    continue;
                }

                Type writerType = typeof(System.Threading.Channels.ChannelWriter<>).MakeGenericType(iface);
                object? writer = services.GetService(writerType);
                if (writer is null)
                {
                    continue;
                }

                MethodInfo? tryWrite = writerType.GetMethod("TryWrite");
                if (tryWrite?.Invoke(writer, [request]) is true)
                {
                    queue = iface.Name;
                    return true;
                }
            }

            queue = null;
            return false;
        }

        private static Exception Inner(Exception e) => e is TargetInvocationException { InnerException: { } i } ? Inner(i) : e;

        private static Task Json(HttpContext ctx, int status, object body) =>
            Raw(ctx, status, JsonSerializer.SerializeToUtf8Bytes(body, Binder.Options));

        private static async Task Raw(HttpContext ctx, int status, byte[] bytes)
        {
            ctx.Response.StatusCode = status;
            ctx.Response.ContentType = "application/json; charset=utf-8";
            ctx.Response.ContentLength = bytes.Length;
            ctx.Response.Headers.CacheControl = "no-store";
            await ctx.Response.Body.WriteAsync(bytes);
        }
    }

    /// <summary>Komendy i zapytania legacy (MediatR IBaseRequest) dostępne z białej listy.</summary>
    internal sealed class Registry
    {
        public Dictionary<string, Type> Allowed { get; } = new(StringComparer.Ordinal);
        public List<string> Missing { get; } = [];
        public int KnownCount { get; private set; }

        public static Registry Load()
        {
            var reg = new Registry();
            var known = new Dictionary<string, Type>(StringComparer.Ordinal);
            var duplicate = new HashSet<string>(StringComparer.Ordinal);
            Assembly app;
            try
            {
                app = Assembly.Load("ErsatzTV.Application");
            }
            catch (Exception e)
            {
                Console.WriteLine($"[vizrs-bridge] brak ErsatzTV.Application: {e.Message}");
                return reg;
            }

            Type[] types;
            try
            {
                types = app.GetTypes();
            }
            catch (ReflectionTypeLoadException e)
            {
                types = e.Types.Where(t => t is not null).ToArray()!;
            }

            foreach (Type t in types)
            {
                if (t is { IsClass: true, IsAbstract: false, IsGenericTypeDefinition: false, IsPublic: true } && typeof(IBaseRequest).IsAssignableFrom(t))
                {
                    if (!known.TryAdd(t.Name, t))
                    {
                        duplicate.Add(t.Name);
                    }
                }
            }

            foreach (string d in duplicate)
            {
                known.Remove(d);
            }

            reg.KnownCount = known.Count;

            string file = Environment.GetEnvironmentVariable("VIZRS_BRIDGE_COMMANDS")
                          ?? Path.Combine(Path.GetDirectoryName(typeof(Registry).Assembly.Location) ?? ".", "commands.txt");
            if (!File.Exists(file))
            {
                Console.WriteLine($"[vizrs-bridge] brak białej listy {file} – żadna komenda nie jest dozwolona");
                return reg;
            }

            foreach (string raw in File.ReadAllLines(file))
            {
                string line = raw.Split('#')[0].Trim();
                if (line.Length == 0)
                {
                    continue;
                }

                if (known.TryGetValue(line, out Type? t))
                {
                    reg.Allowed[line] = t;
                }
                else
                {
                    reg.Missing.Add(line);
                }
            }

            return reg;
        }

        public object Describe() =>
            Allowed.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => new
            {
                name = p.Key,
                kind = p.Value.Namespace?.EndsWith(".Queries", StringComparison.Ordinal) == true ? "query" : "command",
                parameters = Binder.Constructor(p.Value)?.GetParameters().Select(x => new
                {
                    name = x.Name,
                    type = Binder.TypeName(x.ParameterType),
                    optional = x.HasDefaultValue || Binder.IsNullable(x.ParameterType),
                    values = Binder.EnumValues(x.ParameterType),
                }) ?? [],
            }).ToList();
    }

    /// <summary>JSON -> rekord komendy: wybór konstruktora po nazwach parametrów, braki = wartości domyślne.</summary>
    internal static class Binder
    {
        public static readonly JsonSerializerOptions Options = Create();

        private static readonly ConcurrentDictionary<Type, ConstructorInfo?> Ctors = new();

        private static JsonSerializerOptions Create()
        {
            var o = new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
                PropertyNamingPolicy = null, // nazwy pól jak w legacy (PascalCase), zgodne z /vizrs-bridge/commands
                Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
                ReferenceHandler = ReferenceHandler.IgnoreCycles,
                NumberHandling = JsonNumberHandling.AllowReadingFromString,
                MaxDepth = 64,
            };
            o.Converters.Add(new JsonStringEnumConverter());
            o.Converters.Add(new OptionConverterFactory());
            o.Converters.Add(new RuntimeTypeConverterFactory());
            return o;
        }

        public static ConstructorInfo? Constructor(Type t) =>
            Ctors.GetOrAdd(t, x => x.GetConstructors().OrderByDescending(c => c.GetParameters().Length).FirstOrDefault());

        public static object Bind(Type type, JsonElement args)
        {
            var props = new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);
            foreach (JsonProperty p in args.EnumerateObject())
            {
                props[p.Name] = p.Value;
            }

            // najpierw konstruktor, który pokrywa wszystkie wymagane parametry i najwięcej podanych pól
            ConstructorInfo? best = null;
            int bestScore = -1;
            foreach (ConstructorInfo c in type.GetConstructors())
            {
                ParameterInfo[] ps = c.GetParameters();
                if (ps.Any(p => !props.ContainsKey(p.Name!) && !p.HasDefaultValue && !IsNullable(p.ParameterType) && !p.ParameterType.IsValueType && p.ParameterType != typeof(string) && EmptyCollection(p.ParameterType) is null))
                {
                    continue;
                }

                int score = ps.Count(p => props.ContainsKey(p.Name!)) * 100 - ps.Count(p => !props.ContainsKey(p.Name!) && !p.HasDefaultValue);
                if (score > bestScore)
                {
                    best = c;
                    bestScore = score;
                }
            }

            if (best is null)
            {
                throw new ArgumentException("brak pasującego konstruktora – podaj wszystkie wymagane pola (GET /vizrs-bridge/commands)");
            }

            var values = new List<object?>();
            var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (ParameterInfo p in best.GetParameters())
            {
                if (props.TryGetValue(p.Name!, out JsonElement el))
                {
                    used.Add(p.Name!);
                    try
                    {
                        values.Add(el.Deserialize(p.ParameterType, Options));
                    }
                    catch (Exception e)
                    {
                        throw new ArgumentException($"pole '{p.Name}' ({TypeName(p.ParameterType)}): {e.Message}");
                    }
                }
                else if (p.HasDefaultValue)
                {
                    values.Add(p.DefaultValue);
                }
                else if (p.ParameterType == typeof(string))
                {
                    values.Add(string.Empty);
                }
                else if (EmptyCollection(p.ParameterType) is { } empty)
                {
                    values.Add(empty);
                }
                else
                {
                    values.Add(p.ParameterType.IsValueType ? Activator.CreateInstance(p.ParameterType) : null);
                }
            }

            object obj = best.Invoke(values.ToArray());

            // pola spoza konstruktora (init/set), np. BuildPlayout.Start
            foreach (KeyValuePair<string, JsonElement> kv in props)
            {
                if (used.Contains(kv.Key))
                {
                    continue;
                }

                PropertyInfo? prop = type.GetProperty(kv.Key, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
                if (prop is null || !prop.CanWrite)
                {
                    throw new ArgumentException($"nieznane pole '{kv.Key}'");
                }

                prop.SetValue(obj, kv.Value.Deserialize(prop.PropertyType, Options));
            }

            return obj;
        }

        /// <summary>Pusta lista/tablica dla brakującego pola kolekcji (legacy nie przyjmuje null).</summary>
        public static object? EmptyCollection(Type t)
        {
            if (t.IsArray)
            {
                return Array.CreateInstance(t.GetElementType()!, 0);
            }

            if (t.IsGenericType && t.GetGenericArguments().Length == 1)
            {
                Type list = typeof(List<>).MakeGenericType(t.GetGenericArguments()[0]);
                return t.IsAssignableFrom(list) ? Activator.CreateInstance(list) : null;
            }

            return null;
        }

        public static bool IsNullable(Type t) => Nullable.GetUnderlyingType(t) is not null || OptionConverterFactory.IsOption(t);

        public static string TypeName(Type t)
        {
            Type? u = Nullable.GetUnderlyingType(t);
            if (u is not null)
            {
                return TypeName(u) + "?";
            }

            if (OptionConverterFactory.IsOption(t))
            {
                return TypeName(t.GetGenericArguments()[0]) + "?";
            }

            if (t.IsGenericType)
            {
                return t.Name[..t.Name.IndexOf('`')] + "<" + string.Join(", ", t.GetGenericArguments().Select(TypeName)) + ">";
            }

            return t.Name;
        }

        public static string[]? EnumValues(Type t)
        {
            Type e = Nullable.GetUnderlyingType(t) ?? t;
            return e.IsEnum ? Enum.GetNames(e) : null;
        }
    }

    /// <summary>Wyniki legacy (LanguageExt Either/Option) -> {ok, result | error}. Bez zależności od LanguageExt.</summary>
    internal static class Results
    {
        public static object Unwrap(object? result)
        {
            if (result is null)
            {
                return new { ok = true, result = (object?)null };
            }

            Type t = result.GetType();
            string? def = t.IsGenericType ? t.GetGenericTypeDefinition().FullName : null;

            if (def == "LanguageExt.Either`2")
            {
                bool isLeft = (bool)(t.GetProperty("IsLeft")?.GetValue(result) ?? false);
                object? value = t.GetProperty("Case")?.GetValue(result);
                return isLeft ? new { ok = false, error = ErrorText(value) } : new { ok = true, result = Plain(value) };
            }

            if (def == "LanguageExt.Option`1")
            {
                object? value = t.GetProperty("Case")?.GetValue(result);
                Type inner = t.GetGenericArguments()[0];
                if (IsError(inner))
                {
                    return value is null ? new { ok = true, result = (object?)null } : new { ok = false, error = ErrorText(value) };
                }

                return new { ok = true, result = Plain(value) };
            }

            return new { ok = true, result = Plain(result) };
        }

        private static object? Plain(object? v) => v?.GetType().FullName == "LanguageExt.Unit" ? null : v;

        private static bool IsError(Type t)
        {
            for (Type? x = t; x is not null; x = x.BaseType)
            {
                if (x.Name == "BaseError")
                {
                    return true;
                }
            }

            return false;
        }

        private static string ErrorText(object? e)
        {
            if (e is null)
            {
                return "nieznany błąd";
            }

            object? v = e.GetType().GetProperty("Value")?.GetValue(e);
            return v?.ToString() ?? e.ToString() ?? "nieznany błąd";
        }
    }

    /// <summary>LanguageExt Option&lt;T&gt; jako wartość albo null (refleksja, bez odwołania do LanguageExt przy kompilacji).</summary>
    internal sealed class OptionConverterFactory : JsonConverterFactory
    {
        public static bool IsOption(Type t) => t.IsGenericType && t.GetGenericTypeDefinition().FullName == "LanguageExt.Option`1";

        public override bool CanConvert(Type typeToConvert) => IsOption(typeToConvert);

        public override JsonConverter CreateConverter(Type typeToConvert, JsonSerializerOptions options) =>
            (JsonConverter)Activator.CreateInstance(typeof(OptionConverter<>).MakeGenericType(typeToConvert))!;

        private sealed class OptionConverter<TOption> : JsonConverter<TOption>
        {
            private static readonly Type Inner = typeof(TOption).GetGenericArguments()[0];
            private static readonly PropertyInfo Case = typeof(TOption).GetProperty("Case")!;
            private static readonly object None = typeof(TOption).GetField("None", BindingFlags.Public | BindingFlags.Static)!.GetValue(null)!;
            private static readonly MethodInfo Some = typeof(TOption).GetMethod("Some", BindingFlags.Public | BindingFlags.Static, [Inner])!;

            public override TOption Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
            {
                if (reader.TokenType == JsonTokenType.Null)
                {
                    return (TOption)None;
                }

                object? v = JsonSerializer.Deserialize(ref reader, Inner, options);
                return (TOption)(v is null ? None : Some.Invoke(null, [v])!);
            }

            public override void Write(Utf8JsonWriter writer, TOption value, JsonSerializerOptions options)
            {
                object? v = Case.GetValue(value);
                if (v is null)
                {
                    writer.WriteNullValue();
                }
                else
                {
                    JsonSerializer.Serialize(writer, v, v.GetType(), options);
                }
            }

            public override bool HandleNull => true;
        }
    }

    /// <summary>
    /// Abstrakcyjne typy legacy (np. ProgramScheduleItemViewModel) zapisywane po typie rzeczywistym – inaczej
    /// System.Text.Json pisze tylko pola typu deklarowanego i gubi pola podtypów (np. Count, PlayoutDuration).
    /// Tylko zapis; odczyt typu abstrakcyjnego i tak nie jest możliwy.
    /// </summary>
    internal sealed class RuntimeTypeConverterFactory : JsonConverterFactory
    {
        public override bool CanConvert(Type t) =>
            t.IsClass && t.IsAbstract && t.Namespace?.StartsWith("ErsatzTV", StringComparison.Ordinal) == true;

        public override JsonConverter CreateConverter(Type typeToConvert, JsonSerializerOptions options) =>
            (JsonConverter)Activator.CreateInstance(typeof(RuntimeTypeConverter<>).MakeGenericType(typeToConvert))!;

        private sealed class RuntimeTypeConverter<T> : JsonConverter<T>
        {
            public override T Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
                throw new NotSupportedException($"typ abstrakcyjny {typeToConvert.Name} – podaj typ konkretny");

            public override void Write(Utf8JsonWriter writer, T value, JsonSerializerOptions options) =>
                JsonSerializer.Serialize(writer, value, value!.GetType(), options);
        }
    }
}
