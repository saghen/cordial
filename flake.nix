{
  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

  outputs = { nixpkgs, ... }:
    let
      pkgs = nixpkgs.legacyPackages.x86_64-linux;
      fs = pkgs.lib.fileset;

      game-detection = pkgs.rustPlatform.buildRustPackage {
        pname = "game-detection";
        version = "0";
        src = fs.toSource {
          root = ./game-detection;
          fileset = fs.unions [ ./game-detection/src ./game-detection/Cargo.toml ./game-detection/Cargo.lock ];
        };
        cargoLock.lockFile = ./game-detection/Cargo.lock;
      };
      wine-bridge = pkgs.pkgsCross.mingwW64.stdenv.mkDerivation {
        name = "cordial-wine-bridge";
        src = ./game-detection/bridge;
        buildPhase = "$CC -O2 -Wall -static -mwindows -o bridge.exe bridge.c -lws2_32";
        installPhase = "install -D bridge.exe $out/bridge.exe";
      };

      global-keybinds = pkgs.rustPlatform.buildRustPackage {
        pname = "global-keybinds";
        version = "0";
        src = fs.toSource {
          root = ./global-keybinds;
          fileset = fs.unions [ ./global-keybinds/src ./global-keybinds/Cargo.toml ./global-keybinds/Cargo.lock ];
        };
        cargoLock.lockFile = ./global-keybinds/Cargo.lock;
      };

      capture = pkgs.callPackage ./screen-capture/capture { };
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
            fileset = fs.unions [ ./src ./screen-capture/src ./package.json ./package-lock.json ./vite.config.ts ./vite.highlight.config.ts ./tsconfig.json ];
          };
          npmDepsHash = "sha256-r+Jf2Ke9XUba/QJPRrTvRMk6ktFu55KpnpTHZpNWWwY=";
          nativeBuildInputs = [ pkgs.makeWrapper pkgs.copyDesktopItems ];
          desktopItems = [
            # found by "discord" in a launcher too; the window's app id (Wayland) and class (X11) are "cordial"
            (pkgs.makeDesktopItem {
              name = "cordial";
              desktopName = "Cordial";
              genericName = "Internet Messenger";
              comment = "Chat, talk and stream on Discord";
              keywords = [ "discord" "chat" "voice" "messenger" ];
              exec = "cordial %U";
              icon = "cordial";
              startupWMClass = "cordial";
              categories = [ "Network" "InstantMessaging" "Chat" ];
              mimeTypes = [ "x-scheme-handler/discord" ];
            })
          ];
          installPhase = ''
            runHook preInstall
            mkdir -p $out/lib/cordial/src
            cp -r dist package.json $out/lib/cordial/
            cp -r src/shell $out/lib/cordial/src/
            install -D src/shell/icon.svg $out/share/icons/hicolor/scalable/apps/cordial.svg
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
        inherit (pkgs) electron;
      };

      devShells.x86_64-linux.default = pkgs.mkShell {
        packages = [ pkgs.nodejs pkgs.electron pkgs.prettier pkgs.cargo pkgs.rustc pkgs.pkg-config pkgs.rustPlatform.bindgenHook ];
        inputsFrom = [ capture ];
      };
    };
}
