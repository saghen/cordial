{
  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

  outputs = { nixpkgs, ... }:
    let
      pkgs = nixpkgs.legacyPackages.x86_64-linux;
      fs = pkgs.lib.fileset;
      # game detection's native side (src/adapter/native.ts)
      game-detection = pkgs.rustPlatform.buildRustPackage {
        pname = "game-detection";
        version = "0";
        src = fs.toSource {
          root = ./game-detection;
          fileset = fs.unions [ ./game-detection/src ./game-detection/Cargo.toml ./game-detection/Cargo.lock ];
        };
        cargoLock.lockFile = ./game-detection/Cargo.lock;
      };
      # Rich Presence for Wine and Proton games, a Windows program game-detection starts in each prefix
      wine-bridge = pkgs.pkgsCross.mingwW64.stdenv.mkDerivation {
        name = "mincord-wine-bridge";
        src = ./game-detection/bridge;
        buildPhase = "$CC -O2 -Wall -static -mwindows -o bridge.exe bridge.c -lws2_32";
        installPhase = "install -D bridge.exe $out/bridge.exe";
      };
    in
    {
      packages.x86_64-linux = {
        default = pkgs.buildNpmPackage {
          pname = "mincord";
          version = "0";
          src = fs.toSource {
            root = ./.;
            fileset = fs.unions [ ./src ./package.json ./package-lock.json ./vite.config.ts ./tsconfig.json ];
          };
          npmDepsHash = "sha256-QFMwblwopJFT5qZ0c8GUFtYRixNTLPy2ctAvgvl9wMA=";
          nativeBuildInputs = [ pkgs.makeWrapper pkgs.copyDesktopItems ];
          # discord:// links come to mincord when the desktop picks it as their handler (main.js routes them)
          desktopItems = [
            (pkgs.makeDesktopItem {
              name = "mincord";
              desktopName = "mincord";
              exec = "mincord %U";
              icon = "discord";
              categories = [ "Network" "InstantMessaging" ];
              mimeTypes = [ "x-scheme-handler/discord" ];
            })
          ];
          installPhase = ''
            runHook preInstall
            mkdir -p $out/lib/mincord/src
            cp -r dist package.json $out/lib/mincord/
            cp -r src/shell $out/lib/mincord/src/
            makeWrapper ${pkgs.electron}/bin/electron $out/bin/mincord --add-flags $out/lib/mincord \
              --set-default MINCORD_GAME_DETECTION ${game-detection}/bin/game-detection \
              --set-default MINCORD_WINE_BRIDGE ${wine-bridge}/bridge.exe
            runHook postInstall
          '';
        };
        inherit game-detection wine-bridge;
        # ai/lab/wine.py's stand-in for a Windows game
        lab-wine-client = pkgs.pkgsCross.mingwW64.stdenv.mkDerivation {
          name = "mincord-lab-wine-client";
          src = fs.toSource { root = ./ai/lab; fileset = ./ai/lab/wine-client.c; };
          buildPhase = "$CC -O2 -Wall -static -o wine-client.exe wine-client.c";
          installPhase = "install -D wine-client.exe $out/wine-client.exe";
        };
        inherit (pkgs) electron;
      };

      devShells.x86_64-linux.default = pkgs.mkShell {
        packages = [ pkgs.nodejs pkgs.electron pkgs.prettier pkgs.cargo pkgs.rustc ];
      };
    };
}
