# Stock Equibop (nixpkgs as pinned by nixfiles: the same derivation as the lab's equibop-stock) with mincord built in.
# adapter/ and renderer/ are copied into src/renderer/mincord and imported last, so no Equibop file is edited.
#   nix build --impure -f nix/equibop.nix -o .local/lab/equibop-mincord
let
  nixfiles = builtins.getFlake "git+file:///home/saghen/code/personal/nixfiles";
  pkgs = import nixfiles.inputs.nixpkgs { system = "x86_64-linux"; config.allowUnfree = true; };
  fs = pkgs.lib.fileset;
  mincord = fs.toSource { root = ../.; fileset = fs.unions [ ../adapter ../renderer ]; };
in
pkgs.equibop.overrideAttrs (old: {
  pname = "equibop-mincord";
  postPatch = (old.postPatch or "") + ''
    mkdir src/renderer/mincord
    cp -r ${mincord}/adapter ${mincord}/renderer src/renderer/mincord/
    chmod -R u+w src/renderer/mincord
    echo 'import "./mincord/renderer";' >> src/renderer/index.ts
  '';
})
