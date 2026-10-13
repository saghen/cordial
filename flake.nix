{
  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

  outputs = { nixpkgs, ... }:
    let
      pkgs = nixpkgs.legacyPackages.x86_64-linux;
      fs = pkgs.lib.fileset;
      # game detection's native side (src/adapter/games.ts)
      game-detection = pkgs.rustPlatform.buildRustPackage {
        pname = "game-detection";
        version = "0";
        src = fs.toSource {
          root = ./game-detection;
          fileset = fs.unions [ ./game-detection/src ./game-detection/Cargo.toml ./game-detection/Cargo.lock ];
        };
        cargoLock.lockFile = ./game-detection/Cargo.lock;
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
          nativeBuildInputs = [ pkgs.makeWrapper ];
          installPhase = ''
            mkdir -p $out/lib/mincord/src
            cp -r dist package.json $out/lib/mincord/
            cp -r src/shell $out/lib/mincord/src/
            makeWrapper ${pkgs.electron}/bin/electron $out/bin/mincord --add-flags $out/lib/mincord \
              --set-default MINCORD_GAME_DETECTION ${game-detection}/bin/game-detection
          '';
        };
        inherit game-detection;
        inherit (pkgs) electron;
      };

      devShells.x86_64-linux.default = pkgs.mkShell {
        packages = [ pkgs.nodejs pkgs.electron pkgs.prettier pkgs.cargo pkgs.rustc ];
      };
    };
}
