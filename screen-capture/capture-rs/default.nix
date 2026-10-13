# capture's Rust port (P2, see src/main.rs); built beside the C one until P3 picks
{ lib, rustPlatform, pkg-config, libva, pipewire, libgbm, libGL }:
rustPlatform.buildRustPackage {
  pname = "mincord-capture-rs";
  version = "0.1";
  src = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.unions [ ./Cargo.toml ./Cargo.lock ./src ];
  };
  # the git dependency (Discord's cros-libva, with its libva submodule) comes through fetchCargoVendor
  cargoHash = "sha256-xb5PnamFdshvh2o/kdhVAUug73Fq+2ycgz7EbN7eHVY=";
  # bindgen (libclang) over the fork's vendored libva headers and PipeWire's; EGL and GBM for the modifier list
  nativeBuildInputs = [ pkg-config rustPlatform.bindgenHook ];
  buildInputs = [ libva pipewire libgbm libGL ];
  meta.mainProgram = "mincord-capture-rs";
}
