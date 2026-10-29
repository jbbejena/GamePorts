import { campaignFile } from "./campaign-save.js";

export class CampaignFiles {
  constructor(page) {
    this.page = page;
    this.pending = false;
    this.timer = null;
    this.box = document.getElementById("campaign-files");
    this.note = document.getElementById("campaign-file-note");
    this.export = document.getElementById("campaign-export");
    this.import = document.getElementById("campaign-import");
    this.file = document.getElementById("campaign-file");
    this.export.addEventListener("click", () => this.download());
    this.import.addEventListener("click", () => this.file.click());
    this.file.addEventListener("change", () => this.upload());
    page.onMessage("campaignTransfer", (result) => {
      clearTimeout(this.timer);
      this.pending = false;
      this.note.textContent = result.message;
      this.refresh();
    });
  }

  refresh() {
    const page = this.page;
    this.box.hidden = !page.hub?.local || page.screen !== "main";
    this.export.disabled = !page.save || !page.conn || this.pending;
    this.import.disabled = page.save !== null || !page.conn || this.pending;
    document.getElementById("campaign-import-hint").textContent = page.save
      ? "Import is available in a browser profile with no campaign. Your current campaign is kept."
      : "Move a campaign from another browser using its exported JSON file.";
  }

  download() {
    if (this.export.disabled) return;
    const save = campaignFile(this.page.save);
    const url = URL.createObjectURL(new Blob([JSON.stringify(save, null, 2) + "\n"], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `warfare1944-${save.campaign.side}-mission-${save.campaign.mission}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.note.textContent = "Campaign exported. Keep this file to import on another browser or phone.";
  }

  async upload() {
    const file = this.file.files[0];
    this.file.value = "";
    if (!file || this.pending) return;
    try {
      if (file.size > 8192) throw new Error("This save file is too large. Choose an exported Warfare 1944 campaign.");
      const value = JSON.parse(await file.text());
      if (value?.format !== "warfare1944.campaign" || value.version !== 1 || !value.campaign) {
        throw new Error("Choose a Warfare 1944 campaign file exported by this game.");
      }
      if (!this.page.send({ importCampaign: value })) throw new Error("Reconnect before importing a campaign.");
      this.pending = true;
      this.note.textContent = "Checking the campaign with the server…";
      this.refresh();
      this.timer = setTimeout(() => {
        this.pending = false;
        this.note.textContent = "No reply yet. Reconnect to check your campaign before trying again.";
        this.refresh();
      }, 10000);
    } catch (error) {
      this.note.textContent = error instanceof SyntaxError ? "This file is not valid JSON. Choose an exported campaign." : error.message;
    }
  }
}
