# memexhub

1. **memexhub_secret**: a long random value (48+ characters). Keep a copy — it encrypts your connections and backups.
2. **public_url**: the https address Claude will use (for example through the Nabu Casa remote URL's reverse proxy or a Cloudflare Tunnel to port 8787).
3. Start the add-on, open the **Log** tab and copy the one-time setup code.
4. Open `http://<home assistant>:8791`, enter the code and follow the wizard. Choose **Create on this server** for the vault, or point it at a folder under `/share`.

Data lives in the add-on's `/data` (included in Home Assistant backups). Full docs: https://github.com/Hchanghyeon/memexhub/tree/main/docs
