# WhereAmI for Windows

The Tauri shell packages the existing Vite build and uses the Windows WebView2 runtime. The main window owns the workspace cache and cloud connection. The separate overlay window receives the task view from the main window and sends edits back to it, including while the main window is hidden.

Install Rust stable with the Windows MSVC toolchain and Visual Studio Build Tools with **Desktop development with C++**. The WebView2 Evergreen Runtime is included in current versions of Windows. The installer downloads it if required. [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/)

Run these commands from the project root:

```powershell
npm ci
npm run tauri dev
npm run tauri build
```

The release installer is written to `src-tauri/target/release/bundle/nsis/` unless `CARGO_TARGET_DIR` points elsewhere. It installs to the current user's profile. A build without a code-signing certificate produces an unsigned installer. Choose **Add or reinstall** if the installer offers a maintenance choice for an existing installation. Keep the application identifier and WebView2 origin stable across versions to preserve the local workspace.

Press **Ctrl+Shift+Space** while the app is focused to open Quick Capture. **Ctrl+K** opens search. For a cloud-enabled build, set the same Supabase URL and publishable key used by the web build before running the Tauri build. The desktop Content Security Policy permits standard hosted Supabase domains and the local Supabase development endpoint on `127.0.0.1:54321`. If you host Supabase on a custom domain, add its exact HTTPS and WSS origins to `connect-src` in both policies before building.

Open **Task overlay** from the workspace menu. The overlay stays on top while the main window remains available separately. Its previous and next buttons sit below the checklist. Drag the header to move it, drag the corner grip to resize it, or use **Aa** to adjust text size. Closing the main window hides it in the notification area. Use **Open WhereAmI** or **Quit** in the tray menu to restore the window or exit the app.

Run `node src-tauri/tests/smoke.mjs` after building to check the empty canvas, goal setup, native overlay, shared completion, persistence across application restarts, desktop quick capture, and JSON export. The test creates an isolated WebView2 profile under `test-results`. It accepts an optional path to the new executable. Supply the earlier dashboard executable as the second path to additionally verify that its data opens in the revised app.
