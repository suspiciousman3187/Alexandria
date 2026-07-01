# Alexandria

<p align="center">
  <a href="https://github.com/suspiciousman3187/Alexandria/releases/latest">
    <img src="https://img.shields.io/github/downloads/suspiciousman3187/Alexandria/total?style=for-the-badge&color=7C5CD6&label=Total%20Downloads&cacheSeconds=3600" alt="Total Downloads" />
  </a>
  <a href="https://github.com/suspiciousman3187/Alexandria/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-7C5CD6?style=for-the-badge" alt="MIT License" />
  </a>
  <a href="https://discord.gg/vSgYvdh8gT">
    <img src="https://img.shields.io/badge/Discord-Join%20for%20Support-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Join The Discord" />
  </a>
</p>

<p align="center">
  <img src="docs/screenshot.png" alt="Alexandria UI" />
  <br>
  <em>Example of the main Alexandria UI.</em>
</p>

Alexandria is a third party inventory management tool for FFXI focused on multibox support.

> Alexandria is in **BETA** testing. Please use with caution as this tool deals with sensitive parts of the game (items) and there may be bugs.

## Features

### General
- **Unified Inventory Management**: Access and manage every character's inventory through a unified UI with a multitude of actions such as moving items between bags, trading items between characters, listing on the Auction House or in your Bazaar, etc.
- **Currency & Key Items**: All currencies (gil, sparks, gallimaufry, segments, and more) in expandable rows that are searchable and filterable.
- **Automated Drop/Watch/Sell Lists**: Drop/Watch/Sell lists allow Alexandria to manage your inventory automatically.
- **Treasure Pool**: Live party-wide treasure pool with lot/pass controls & auto-lot/pass rules.
- **Auction House**: Browse the Auction House, manage your listings, and buy/sell items straight from your inventory.
- **Delivery Box**: Manage the Delivery Box with full mail capabilities.
- **Bazaar**: Manage your Bazaar and browse Bazaars of nearby players.

### Tools
- **Organize**: Automatically organize and consolidate stackable items in your inventory.
- **NPC Storage**: Store common NPC Materials like Rem's Tales, Beastman Seals, etc.
- **Curio Restock**: Automated supply restocking when near a Curio Moogle.
- **Storage Slips**: Manage Storage slips with automated storage/retrieval when near a Porter Moogle.
- **Sparks/Unity Conversion**: Automated sparks/unity to gil conversion.
- **Augment Gear**: Automated Ambuscade / Reive / Skirmish / Geas Fete augment rolling.

### Legacy CLI Commands
- **Top Level CLI Commands**: CLI commands available based on Legacy inventory management addons like FindAll & Itemizer with the use of (`//ax`, `//alex`).

The following commands are available currently, based on various legacy addons that were used to create Alexandria:

| Command | Arguments | Description |
| --- | --- | --- |
| `use` | `<item> [count]` | Use / activate an item. |
| `move` | `<item> [from] <to> [count]` | Move an item between bags (`moves` for the whole stack). |
| `get` | `<item> [bag] [count]` | Pull an item from a bag into inventory (`gets` for the whole stack). |
| `put` | `<item> <bag> [count]` | Push an item from inventory into a bag (`puts` for the whole stack). |
| `stack` | none | Merge all loose stacks across every bag. |
| `find` | `<item>` | Search the current character for an item. |
| `findall` | `<item>` | Search every connected character. |
| `ah` | `[buy\|sell\|clear] <item> <stack\|single> <price>` | Open the Auction House, or buy / sell / clear a listing. |
| `bazaar` | `<item> <price>` | List an item in your bazaar at a price. |
| `trade` | `<player> <item> [count]` | Trade an item to another character. |
| `organize` | none | Auto-organize and consolidate your inventory. |
| `light-organize` | none | Organize using only the storage bags currently available. |
| `store` | `<alex\|rem\|seal\|crystal>` | Store common NPC materials. |
| `drop` | `<item>` | Drop an item. |
| `lot` | `<add\|remove\|all> <item>` | Lot a pool item or manage auto-lot rules. |
| `pass` | `<add\|remove\|all> <item>` | Pass a pool item or manage auto-pass rules. |
| `lotall` / `passall` | none | Lot or pass everything in the treasure pool. |
| `done` | none | Pass every pool item you have not lotted. |
| `watch` | `<add\|remove> <item> [threshold]` | Add / remove a watch-list item with a low-stock threshold. |
| `help` / `list` | none | List all verbs, or your saved aliases. |

### EXPERIMENTAL FEATURES (USE AT YOUR OWN RISK!)
- **Experimental Features**: Removes distance requires for various NPCs, allowing you to trade, sell, and interact from anywhere in the zone.

## Screenshots

Click a section to expand its screenshots (shown at full size).

<details open>
<summary><b>Inventory</b>: Actions, Currency, Key Items, Drop List, Consolidate</summary>
<br>
<table>
  <tr>
    <td width="50%" align="center"><img src="docs/screenshots/inventoryactions.png" alt="Inventory Actions" /><br><em>Inventory Actions</em></td>
    <td width="50%" align="center"><img src="docs/screenshots/keyitems.png" alt="Key Items" /><br><em>Key Items</em></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="docs/screenshots/currency1.png" alt="Currency" /><br><em>Currency</em></td>
    <td width="50%" align="center"><img src="docs/screenshots/currency2.png" alt="Currency Details" /><br><em>Currency Details</em></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="docs/screenshots/droplist.png" alt="Drop List" /><br><em>Drop List</em></td>
    <td width="50%" align="center"><img src="docs/screenshots/consolidate.png" alt="Consolidate" /><br><em>Consolidate</em></td>
  </tr>
</table>
</details>

<details>
<summary><b>Treasure Pool</b></summary>
<br>
<table>
  <tr>
    <td width="50%" align="center"><img src="docs/screenshots/treasurepool.png" alt="Treasure Pool" /><br><em>Treasure Pool</em></td>
    <td width="50%"></td>
  </tr>
</table>
</details>

<details>
<summary><b>Market</b>: Auction House, Bazaar, Delivery Box, Sell List</summary>
<br>
<table>
  <tr>
    <td width="50%" align="center"><img src="docs/screenshots/auctionhousebrowse.png" alt="Auction House Browse" /><br><em>AH Browse</em></td>
    <td width="50%" align="center"><img src="docs/screenshots/auctionhouseinspect.png" alt="Auction House Inspect" /><br><em>AH Inspect</em></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="docs/screenshots/auctionhouselisting.png" alt="Auction House Listings" /><br><em>AH Listings</em></td>
    <td width="50%" align="center"><img src="docs/screenshots/bazaar.png" alt="Bazaar" /><br><em>Bazaar</em></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="docs/screenshots/mailitems.png" alt="Mail Items" /><br><em>Mail Items</em></td>
    <td width="50%" align="center"><img src="docs/screenshots/mailitems2.png" alt="Delivery Box" /><br><em>Delivery Box</em></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="docs/screenshots/selllist.png" alt="Sell List" /><br><em>Sell List</em></td>
    <td width="50%"></td>
  </tr>
</table>
</details>

<details>
<summary><b>Tools</b>: Organize, NPC Storage, Curio Restock, Sparks / Unity</summary>
<br>
<table>
  <tr>
    <td width="50%" align="center"><img src="docs/screenshots/organize.png" alt="Organize" /><br><em>Organize</em></td>
    <td width="50%" align="center"><img src="docs/screenshots/npcstorage.png" alt="NPC Storage" /><br><em>NPC Storage</em></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="docs/screenshots/curiorestock.png" alt="Curio Restock" /><br><em>Curio Restock</em></td>
    <td width="50%" align="center"><img src="docs/screenshots/curiorestock2.png" alt="Curio Restock" /><br><em>Curio Restock</em></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="docs/screenshots/sparksunity.png" alt="Sparks / Unity" /><br><em>Sparks / Unity</em></td>
    <td width="50%"></td>
  </tr>
</table>
</details>

<details>
<summary><b>Augment</b>: Ambuscade, Reive, Skirmish, Geas Fete</summary>
<br>
<table>
  <tr>
    <td width="50%" align="center"><img src="docs/screenshots/ambuscade.png" alt="Ambuscade" /><br><em>Ambuscade</em></td>
    <td width="50%" align="center"><img src="docs/screenshots/reive.png" alt="Reive" /><br><em>Reive</em></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="docs/screenshots/skirmish.png" alt="Skirmish" /><br><em>Skirmish</em></td>
    <td width="50%" align="center"><img src="docs/screenshots/geasfete.png" alt="Geas Fete" /><br><em>Geas Fete</em></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="docs/screenshots/geasfete2.png" alt="Geas Fete" /><br><em>Geas Fete</em></td>
    <td width="50%" align="center"><img src="docs/screenshots/geasfete3.png" alt="Geas Fete" /><br><em>Geas Fete</em></td>
  </tr>
</table>
</details>

## Download & Install

Grab the latest build from the
[**Releases**](https://github.com/suspiciousman3187/Alexandria/releases/latest)
page. Two assets are provided:

- **`Alexandria-Desktop`**: Main desktop application installer.
- **`Alexandria-Addon`**: Companion windower addon. Alexandria requires the addon to be running to be able to talk to the app.

## Requirements

- Windows 10 / 11
- Final Fantasy XI installed (any region)
- [Windower 4](https://www.windower.net/) with the Alexandria addon loaded
- WebView2 runtime (pre-installed on modern Windows; auto-installs if missing)

## Bugs

This tool is experimental and there may be bugs. Please use at your
own risk. Feel free to reach out on Discord if you find any.

## Credits

Alexandria was built through a combination of private addons I made for myself & numerous public addons released throughout history to aid in managing the player's inventory.

For that, I would like to give thanks to all the addons that were used to make this tool a reality, which I have tried my best to list below:

- **FindAll**
- **Itemizer**
- **AuctionHelper**
- **Auctioneer**
- **Drop**
- **Dupefind**
- **Trade**
- **TradePlayer**
- **MuleTrade**
- **MassTrade**
- **QuickTrade2**
- **PorterPacker**
- **Sparky**
- **UnityNPC**
- **Pouches**
- **Pricer**
- **SellNPC**
- **StoreMats**
- **Treasury**
- **Lottery**
- **TreasurePool**
- **CapeTrader**
- **Augmentation (Silmaril)**

## License

MIT. See [LICENSE](LICENSE).
