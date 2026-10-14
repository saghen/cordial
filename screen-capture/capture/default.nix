{ lib, rustPlatform, pkg-config, libva, pipewire, libgbm, libGL }:
rustPlatform.buildRustPackage {
  pname = "cordial-capture";
  version = "0.3";
  src = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.unions [ ./Cargo.toml ./Cargo.lock ./src ];
  };
  # git dependency requires hash
  cargoHash = "sha256-LHb1PAxvrO0GelVSlkM7AOescuu99HoEq/r6aA10gaU=";
  # bindgen (libclang) over the fork's vendored libva headers and PipeWire's; EGL and GBM for the modifier list
  nativeBuildInputs = [ pkg-config rustPlatform.bindgenHook ];
  buildInputs = [ libva pipewire libgbm libGL ];
  meta.mainProgram = "cordial-capture";
}
