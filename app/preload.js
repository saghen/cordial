// runs before Discord's scripts, and has to run our bundle before them too: it has to see webpack start
// (adapter/webpack.ts). executeInMainWorld is synchronous, unlike webFrame.executeJavaScript
const { contextBridge } = require("electron");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const src = readFileSync(path.join(__dirname, "../dist/mincord.js"), "utf8") + "\n//# sourceURL=mincord.js";
contextBridge.executeInMainWorld({ func: src => (0, eval)(src), args: [src] });
