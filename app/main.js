const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");

// Discord's web client, as Chrome would load it
app.userAgentFallback = app.userAgentFallback.replace(/ (mincord|Electron)\/\S+/g, "");

app.whenReady().then(() => {
    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        backgroundColor: "#1e1e2e",
        autoHideMenuBar: true,
        webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: false }
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: "deny" };
    });
    win.loadURL("https://discord.com/app");
});

app.on("window-all-closed", () => app.quit());
