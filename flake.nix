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
        name = "cordial-wine-bridge";
        src = ./game-detection/bridge;
        buildPhase = "$CC -O2 -Wall -static -mwindows -o bridge.exe bridge.c -lws2_32";
        installPhase = "install -D bridge.exe $out/bridge.exe";
      };
      # global keybinds with releases (push to talk) through the desktop's GlobalShortcuts portal (src/shell/main.js)
      global-keybinds = pkgs.rustPlatform.buildRustPackage {
        pname = "global-keybinds";
        version = "0";
        src = fs.toSource {
          root = ./global-keybinds;
          fileset = fs.unions [ ./global-keybinds/src ./global-keybinds/Cargo.toml ./global-keybinds/Cargo.lock ];
        };
        cargoLock.lockFile = ./global-keybinds/Cargo.lock;
      };
      # Go Live's capture and encoder (screen-capture/)
      capture = pkgs.callPackage ./screen-capture/capture { };
      # its fallback's fd socket for Electron's main process (N-API: the symbols resolve from Electron at load)
      fdsock = pkgs.stdenv.mkDerivation {
        name = "cordial-fdsock";
        src = fs.toSource { root = ./screen-capture/addon; fileset = ./screen-capture/addon/fdsock.c; };
        buildPhase = "$CC -shared -fPIC -O2 -Wall -I${pkgs.nodejs}/include/node -o fdsock.node fdsock.c";
        installPhase = "install -D fdsock.node $out/lib/fdsock.node";
      };
    in
    {
      packages.x86_64-linux = {
        default = pkgs.buildNpmPackage {
          pname = "cordial";
          version = "0";
          src = fs.toSource {
            root = ./.;
            fileset = fs.unions [ ./src ./screen-capture/src ./package.json ./package-lock.json ./vite.config.ts ./tsconfig.json ];
          };
          npmDepsHash = "sha256-QFMwblwopJFT5qZ0c8GUFtYRixNTLPy2ctAvgvl9wMA=";
          nativeBuildInputs = [ pkgs.makeWrapper pkgs.copyDesktopItems ];
          # discord:// links come to cordial when the desktop picks it as their handler (main.js routes them)
          desktopItems = [
            (pkgs.makeDesktopItem {
              name = "cordial";
              desktopName = "cordial";
              exec = "cordial %U";
              icon = "discord";
              categories = [ "Network" "InstantMessaging" ];
              mimeTypes = [ "x-scheme-handler/discord" ];
            })
          ];
          installPhase = ''
            runHook preInstall
            mkdir -p $out/lib/cordial/src
            cp -r dist package.json $out/lib/cordial/
            cp -r src/shell $out/lib/cordial/src/
            mkdir -p $out/lib/cordial/screen-capture/src
            cp -r screen-capture/src/main screen-capture/src/preload $out/lib/cordial/screen-capture/src/
            makeWrapper ${pkgs.electron}/bin/electron $out/bin/cordial --add-flags $out/lib/cordial \
              --set-default CORDIAL_GAME_DETECTION ${game-detection}/bin/game-detection \
              --set-default CORDIAL_WINE_BRIDGE ${wine-bridge}/bridge.exe \
              --set-default CORDIAL_GLOBAL_KEYBINDS ${global-keybinds}/bin/global-keybinds \
              --set-default CORDIAL_CAPTURE ${capture}/bin/cordial-capture \
              --set-default CORDIAL_FDSOCK ${fdsock}/lib/fdsock.node
            runHook postInstall
          '';
        };
        inherit game-detection wine-bridge global-keybinds capture fdsock;
        # ai/lab/wine.py's stand-in for a Windows game
        lab-wine-client = pkgs.pkgsCross.mingwW64.stdenv.mkDerivation {
          name = "cordial-lab-wine-client";
          src = fs.toSource { root = ./ai/lab; fileset = ./ai/lab/wine-client.c; };
          buildPhase = "$CC -O2 -Wall -static -o wine-client.exe wine-client.c";
          installPhase = "install -D wine-client.exe $out/wine-client.exe";
        };
        inherit (pkgs) electron;
      };

      devShells.x86_64-linux.default = pkgs.mkShell {
        packages = [ pkgs.nodejs pkgs.electron pkgs.prettier pkgs.cargo pkgs.rustc pkgs.pkg-config pkgs.rustPlatform.bindgenHook ];
        inputsFrom = [ capture ];
      };
    };
}
