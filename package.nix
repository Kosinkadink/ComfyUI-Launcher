{
  lib,
  buildNpmPackage,
  electron,
  makeWrapper,
  copyDesktopItems,
  makeDesktopItem,
  p7zip,
}:

buildNpmPackage rec {
  pname = "comfyui-launcher";
  version = "0.1.3";

  src = ./.;

  npmDepsHash = "";  # Run `nix build` once to get the correct hash from the error message

  nativeBuildInputs = [
    makeWrapper
    copyDesktopItems
  ];

  env = {
    ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
    CSC_IDENTITY_AUTO_DISCOVERY = "false";
  };

  makeCacheWritable = true;

  postBuild = ''
    cp -r ${electron.dist} electron-dist
    chmod -R u+w electron-dist

    npm exec electron-builder -- \
        --dir \
        -c.npmRebuild=true \
        -c.asarUnpack="**/*.node" \
        -c.electronDist=electron-dist \
        -c.electronVersion=${electron.version}
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/share/comfyui-launcher
    cp -r dist/*-unpacked/resources/* $out/share/comfyui-launcher/

    makeWrapper ${lib.getExe electron} $out/bin/comfyui-launcher \
      --add-flags $out/share/comfyui-launcher/app.asar \
      --add-flags "\''${NIXOS_OZONE_WL:+\''${WAYLAND_DISPLAY:+--ozone-platform-hint=auto --enable-features=WaylandWindowDecorations}}" \
      --set ELECTRON_IS_DEV 0 \
      --prefix PATH : ${lib.makeBinPath [ p7zip ]} \
      --inherit-argv0

    install -D -m 644 assets/Comfy_Logo_x256.png $out/share/icons/hicolor/256x256/apps/comfyui-launcher.png

    runHook postInstall
  '';

  desktopItems = [
    (makeDesktopItem {
      name = "comfyui-launcher";
      exec = "comfyui-launcher %U";
      icon = "comfyui-launcher";
      desktopName = "ComfyUI Launcher";
      comment = "Launcher for ComfyUI";
      categories = [ "Development" "Graphics" ];
    })
  ];

  meta = {
    description = "Electron-based launcher for ComfyUI";
    homepage = "https://github.com/Kosinkadink/ComfyUI-Launcher";
    license = lib.licenses.mit;
    mainProgram = "comfyui-launcher";
    platforms = lib.platforms.linux;
  };
}
