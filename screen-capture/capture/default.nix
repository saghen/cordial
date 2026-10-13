# mincord's Go Live encoder (ported from Equibop's castscale); see capture.c
{ lib, stdenv, pkg-config, pipewire, libva, libdrm, libgbm, libGL, systemdLibs }:
stdenv.mkDerivation {
  pname = "mincord-capture";
  version = "0.2";
  src = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.unions [ ./Makefile ./capture.c ./av1enc.c ./av1enc.h ];
  };
  nativeBuildInputs = [ pkg-config ];
  buildInputs = [ pipewire libva libdrm libgbm libGL systemdLibs ];
  makeFlags = [ "PREFIX=$(out)" ];
  meta.mainProgram = "mincord-capture";
}
