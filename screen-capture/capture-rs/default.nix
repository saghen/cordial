# capture's Rust port (P2, see src/main.rs); built beside the C one until P3 picks
{ lib, rustPlatform, pkg-config, libva }:
rustPlatform.buildRustPackage {
  pname = "mincord-capture-rs";
  version = "0.1";
  src = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.unions [ ./Cargo.toml ./Cargo.lock ./src ];
  };
  # the git dependency (Discord's cros-libva, with its libva submodule) comes through fetchCargoVendor
  cargoHash = "sha256-L3vh6rOUUsiF8UeE9fRa4zxgNy40zKckRpu6BNe86Ls=";
  # bindgen (libclang) over the fork's vendored libva headers; libva itself at run time
  nativeBuildInputs = [ pkg-config rustPlatform.bindgenHook ];
  buildInputs = [ libva ];
  meta.mainProgram = "mincord-capture-rs";
}
