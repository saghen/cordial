# mincord's Go Live encoder (see src/main.rs)
{ lib, rustPlatform, pkg-config, libva, pipewire, libgbm, libGL }:
rustPlatform.buildRustPackage {
  pname = "mincord-capture";
  version = "0.3";
  src = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.unions [ ./Cargo.toml ./Cargo.lock ./src ];
  };
  # the git dependency (Discord's cros-libva, with its libva submodule) comes through fetchCargoVendor
  cargoHash = "sha256-tOK4ARTS0XhpiPlEmaNXfXvEqOlUFW/4cNNmUkkZ2x8=";
  # bindgen (libclang) over the fork's vendored libva headers and PipeWire's; EGL and GBM for the modifier list
  nativeBuildInputs = [ pkg-config rustPlatform.bindgenHook ];
  buildInputs = [ libva pipewire libgbm libGL ];
  meta.mainProgram = "mincord-capture";
}
