# ErsatzTV legacy z mostem VizRS (bez zmiany kodu legacy).
# Budowa (z katalogu repozytorium):
#   docker build -f docker/legacy-bridge.Dockerfile -t vizrs-live-legacy .
#   docker build -f docker/legacy-bridge.Dockerfile --build-arg LEGACY_IMAGE=ghcr.io/ersatztv/legacy:<wersja> -t vizrs-live-legacy .
ARG LEGACY_IMAGE=ghcr.io/ersatztv/legacy:v26.12.0
ARG DOTNET_SDK=mcr.microsoft.com/dotnet/sdk:10.0

FROM ${LEGACY_IMAGE} AS legacy

FROM ${DOTNET_SDK} AS build
# MediatR prosto z obrazu legacy: wersja zawsze ta sama co w legacy
COPY --from=legacy /app/MediatR.dll /app/MediatR.Contracts.dll /legacy-lib/
COPY bridge/VizRS.Bridge.csproj bridge/Bridge.cs /src/
RUN dotnet build /src/VizRS.Bridge.csproj -c Release -o /out -p:LegacyDir=/legacy-lib --nologo -v q

FROM ${LEGACY_IMAGE}
COPY --from=build /out/VizRS.Bridge.dll /vizrs-bridge/VizRS.Bridge.dll
COPY bridge/commands.txt /vizrs-bridge/commands.txt
ENV DOTNET_STARTUP_HOOKS=/vizrs-bridge/VizRS.Bridge.dll \
    ASPNETCORE_HOSTINGSTARTUPASSEMBLIES=VizRS.Bridge
