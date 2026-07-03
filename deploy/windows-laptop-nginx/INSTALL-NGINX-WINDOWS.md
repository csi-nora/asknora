# Install and start nginx on Windows (your laptop / home server)

These steps use the **official nginx for Windows** build. No WSL required.

---

## 1. Download nginx

1. Open **[https://nginx.org/en/download.html](https://nginx.org/en/download.html)**.
2. Under **Stable version**, download **nginx/Windows-1.xx.x** (zip file).

---

## 2. Extract to a simple path

1. Extract the zip (e.g. with File Explorer or **Extract All…**).
2. Move the folder so the full path is short and has **no spaces**, for example:
   - **`C:\nginx`**
   - or **`C:\tools\nginx`**

You should have **`C:\nginx\nginx.exe`** (path may vary if you chose another folder).

---

## 3. First start (welcome page)

1. Open **Command Prompt** or **PowerShell** **as Administrator** (needed if Windows blocks low ports; CSI Nora uses port **8090** after you add our site config).
2. Go to the nginx folder:

```powershell
cd C:\nginx
```

3. Test the configuration:

```powershell
.\nginx.exe -t
```

You should see `syntax is ok` and `test is successful`.

4. Start nginx:

```powershell
.\nginx.exe
```

5. Open a browser: **[http://127.0.0.1/](http://127.0.0.1/)** (default config listens on **port 80**).  
   You should see the **“Welcome to nginx!”** page.  
   After you add **`csi-nora-http.conf`** (`listen 8090`), open **[http://127.0.0.1:8090/](http://127.0.0.1:8090/)** for CSI Nora.

---

## 4. Stop and reload (after you change config)

| Action | Command (run from `C:\nginx`) |
|--------|-------------------------------|
| **Reload** config (no full stop) | `.\nginx.exe -s reload` |
| **Stop** nginx | `.\nginx.exe -s quit` |
| **Quick stop** (if needed) | `.\nginx.exe -s stop` |

Always run **`.\nginx.exe -t`** before **`-s reload`** to catch errors.

---

## 5. Use CSI Nora site config (this project)

1. **Backup** the default config:

```powershell
copy C:\nginx\conf\nginx.conf C:\nginx\conf\nginx.conf.bak
```

2. Edit **`C:\nginx\conf\nginx.conf`** in a text editor **as Administrator** if needed.

3. Inside the top-level **`http {`** block (there is usually one), **paste** the contents of:

   **`deploy/windows-laptop-nginx/csi-nora-http.conf`**

   from your CSI Nora repo.

4. Check that **`root`** points to your built app, e.g.:

   `root C:/csi-nora-deploy/browser;`

   (Forward slashes work on Windows in nginx.)

5. Test and reload:

```powershell
cd C:\nginx
.\nginx.exe -t
.\nginx.exe -s reload
```

If nginx was not running yet, use **`.\nginx.exe`** instead of **reload**.

6. Keep **`npm run gateway`** running in another window (port **3456**) so **`/api/`** works.

---

## 6. Windows Firewall (internet access on port 8090)

**PowerShell as Administrator:**

```powershell
New-NetFirewallRule -DisplayName "HTTP nginx 8090" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8090
```

Your **router** must also **forward TCP port 8090** to this PC’s **LAN IP** if you want access from outside the LAN.

---

## Troubleshooting

| Problem | What to do |
|---------|------------|
| **`bind() to 0.0.0.0:8090 failed`** | Another program is using **8090**. Find it or pick another port in `csi-nora-http.conf` and rebuild with matching `CSI_NORA_PUBLIC_ORIGIN` (e.g. `:8100`). |
| **nginx won’t start** | Run `.\nginx.exe -t` and read the error line number in `nginx.conf`. |
| **403 Forbidden** | Wrong **`root`** path; folder must contain **`index.html`**. |
| **502 on /api/** | Run **`npm run gateway`** from the CSI Nora project; check **`proxy_pass`** port **3456**. |

---

## Optional: nginx in WSL (Ubuntu)

If you prefer Linux nginx inside WSL:

```bash
sudo apt update && sudo apt install -y nginx
sudo nginx -t
sudo service nginx start
```

Config lives under `/etc/nginx/`. Port **8090** from the internet on WSL2 needs extra Windows→WSL port forwarding; the **Windows nginx zip** above is simpler for a laptop server.
