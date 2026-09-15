_addon.name = 'Alexandria'
_addon.author = 'Noirblanc'
_addon.version = '0.0.27'
_addon.commands = {'alexandria', 'alex', 'ax'}

local socket = require('socket')
local res = require('resources')
local config = require('config')
require('strings')
require('lists')
require('pack')
require('chat')

local compat_defaults = { compat = { find = true, item = true, ah = true, native = true }, auto_sort_on_move = true }
settings = config.load(compat_defaults)

HOST = '127.0.0.1'
PORT = 24233
local SEND_INTERVAL = 4.0
local RETRY_INTERVAL = 5.0
local INV_DEBOUNCE = 0.6

local conn = nil
local connected = false
local last_send = 0
local last_try = 0
local conn_pending = nil
local conn_pending_t = 0
local retry_delay = RETRY_INTERVAL
local RETRY_MAX = 15.0
local CONN_TIMEOUT = 3.0
local rx = ''
local txbuf = ''
-- Sage master-overlay fan-out: a SECOND socket teeing our frames to Sage (127.0.0.1:2027) and reading pool
-- commands back through the SAME dispatch(). Globals (not locals) to stay clear of Lua's 200-local limit.
SAGE_HOST = '127.0.0.1'
SAGE_PORT = 2027
SAGE_RETRY = 5.0
sage_conn = nil
sage_connected = false
sage_rx = ''
sage_txbuf = ''
sage_last_try = 0
mem_log_on = false
mem_sample_t = 0
mem_log_interval = 600
local inv_dirty = false
local inv_dirty_at = 0
-- Last player id announced to the desktop via 'self'/'hello'. Global (not a main-chunk
-- local) to stay clear of Lua's 200-local limit. Drives an instant identity re-announce
-- the instant a shared client swaps characters, before the incoming inventory streams.
last_self_id = nil
local inv_first_dirty = 0
local autosort_bags = {}
local autosort_sig = {}
local ki_dirty = false
local ki_dirty_at = 0
local ki_last = ''

drop_names = {}
auto_drop = false
drop_queued = {}

use_id = nil
use_name = nil
use_left = 0
use_delay = 0
use_next = 0
use_pending = nil
use_total = 0
use_done = 0
use_move_at = 0

currency_cur1 = nil
currency_cur2 = nil
currency_cur1_id = nil  -- character id each currency page was received under, so a page left over
currency_cur2_id = nil  -- from a previous character on a shared client is never reported as ours
currency_dirty = false
currency_req_t = 0

ah_box = nil
ah_initialized = false
ah_last4e = nil
ah_queue = {}
ah_t = 0
ah_dirty = false
AH_DELAY = 4
ah_busy = false
ah_busy_t = 0
AH_BUSY_TIMEOUT = 15
ah_err_pending = nil
AH_ERR_DEFER = 2.0
ah_last_bid = nil
ah_auto_t = 0
ah_auto_tries = 0
dbox = { open = nil, inbox = {}, outbox = {} }
dbox_dirty = false
shop = { items = {} }
shop_dirty = false
shop_sell_list = {}
shop_autosell = false
sell_anywhere = false
shop_session = false
loaded_since = 0    -- os.clock() when the client first became fully in-world (0 while loading); buffer counts from HERE
AUTO_SETTLE = 15    -- seconds fully-in-world before ANY auto packet action fires, so nothing injects during/just after a load
shop_sold = {}
shop_pending_sell = nil
shop_manual_until = 0
drop_pending = nil
drop_move_q = {}

-- Town/city zones (safe NPC hubs) where "Auto-Sell In Towns" is allowed to fire without
-- an open shop. Curated from Windower res/zones.lua (no town flag exists there): the three
-- nations + their inner areas, Jeuno, the outpost towns, Aht Urhgan, Adoulin, and the three
-- WotG [S] cities. Add ids here to broaden coverage.
TOWN_ZONES = {
    [26] = true, [48] = true, [50] = true, [53] = true, [80] = true, [87] = true, [94] = true,
    [230] = true, [231] = true, [232] = true, [233] = true, [234] = true, [235] = true, [236] = true, [237] = true,
    [238] = true, [239] = true, [240] = true, [241] = true, [242] = true, [243] = true, [244] = true, [245] = true, [246] = true,
    [247] = true, [248] = true, [249] = true, [250] = true, [252] = true, [256] = true, [257] = true,
    [280] = true,
}
function in_town()
    local info = windower.ffxi.get_info()
    return (info and TOWN_ZONES[info.zone]) and true or false
end
sell_log = false
shop_opened_t = 0
resupply_on = false
resupply_min = {}
resupply_opts = {}
resupply_run = nil
resupply_cd = 0
resupply_cd_npc = nil
resupply_fails = {}         -- curio npc id -> consecutive partial-failure count, to bound retries
CURIO_NAME = 'Curio Vendor Moogle'
-- Proximity Buy/Sell vendors. FFXI exposes no shop-detection, so this is a curated map of
-- NPC name -> the item ids it sells. The run drives them with the same packet engine as
-- Curio (poke -> 0x03C shop list -> 0x083 buy), never keypresses. Grow this table freely.
PVENDOR_SHOPS = {
    ['Preterig']      = { 5944 },   -- Frontier Soda
    ['Bernegeois']    = { 5944 },   -- Frontier Soda
    ['Hagakoff']      = { 18259 },  -- Angon
    ['Wata Khamazom'] = { 18258 },  -- Thr. Tomahawk
    ['Jajaroon']      = { 5870 },   -- Trump Card Case
}
pvendor_on = false
pvendor_min = {}            -- item id -> target count
pvendor_run = nil
pvendor_cd = 0
pvendor_cd_npc = nil
pvendor_near = nil          -- { name, id, index } of the nearest cataloged vendor
pvendor_near_dirty = false
pvendor_fails = {}          -- npc id -> consecutive shop-did-not-open count, to bound retries
pvendor_progress = nil
pvendor_dirty = false
npc_menu = nil
npc_near = nil
npc_near_dirty = false
npc_near_t = 0
npc_near_seen = 0
npc_watch = {}
experimental_features = false
nomad_near = false
last_open_zone = 0
fixed_near = {}
fixed_near_key = ''
fixed_near_dirty = false
store_eph_near = false
npc_last_select = nil
npc_learn = nil
npc_learn_dirty = false
npc_pending = nil
npc_driving = nil
trade_wl = {}
trade_wl_ids = {}
trade_armed = nil
trade_debug = false
trade_counter = 0
trade_tx = nil
trade_rx = nil
trade_rx_t = 0
trade_status_dirty = false
trade_result = nil
TRADE_TIMEOUT = 15
TRADE_ARM_WINDOW = 12
aug = nil
aug_dirty = false
aug_info = nil
aug_info_dirty = false
bz_flags = {}
bz_sellers_dirty = false
bz_sellers_t = 0
bz_collect = nil
bz_collecting = false
bz_items_dirty = false
bz_my_dirty = false
bz_sweep = nil
bz_sweep_dirty = false
bz_buy = nil
bz_buy_msg = nil
bz_buy_dirty = false
bz_clear_pending = false
bz_range = 20
bz_entity_base = 0
bz_mem_ok = false
bz_watching = false
ah_cat_list = nil
ah_cat_i = 0
ah_cat_run = false
local AH_ZONES = {
    ['Bastok Mines'] = true, ['Bastok Markets'] = true, ['Norg'] = true, ["Southern San d'Oria"] = true,
    ["Port San d'Oria"] = true, ['Rabao'] = true, ['Windurst Woods'] = true, ['Windurst Walls'] = true,
    ['Kazham'] = true, ['Lower Jeuno'] = true, ["Ru'Lude Gardens"] = true, ['Port Jeuno'] = true,
    ['Upper Jeuno'] = true, ['Aht Urhgan Whitegate'] = true, ['Al Zahbi'] = true, ['Nashmau'] = true,
    ['Tavnazian Safehold'] = true, ['Western Adoulin'] = true, ['Eastern Adoulin'] = true,
}

local NOMAD_ZONES = { [26] = true, [53] = true, [247] = true, [248] = true, [249] = true, [250] = true, [252] = true }

if windower.dir_exists and not windower.dir_exists(windower.addon_path .. 'data') then
    windower.create_dir(windower.addon_path .. 'data')
end

local icon_ok, icon_extractor = pcall(require, 'icon_extractor')
local icon_dir = windower.addon_path .. 'data/assets'
local icon_prefix = icon_dir .. '/icon_'
local icon_queue = {}
local icon_drain_t = 0
icon_bulk = false
icon_bulk_total = 0
icon_bulk_t = 0
icon_passive = false
if icon_ok and windower.dir_exists and not windower.dir_exists(icon_dir) then
    windower.create_dir(icon_dir)
end

local function queue_icon(id)
    if not icon_ok or not icon_passive or not id or id == 0 then return end
    if icon_queue[id] then return end
    if windower.file_exists and windower.file_exists(icon_prefix .. id .. '.bmp') then return end
    icon_queue[id] = true
end

function ah_queue_icons(ids)
    for _, iid in ipairs(ids) do
        local n = tonumber(iid)
        if n then queue_icon(n) end
    end
end

local json_ok, json = pcall(require, 'dkjson')
local packets_ok, packets = pcall(require, 'packets')
local extdata_ok, extdata = pcall(require, 'extdata')
local memhelp_ok, memhelp = false, nil
do
    local ok = pcall(function() package.cpath = package.cpath .. ';' .. windower.addon_path:gsub('\\', '/') .. 'libs/?.dll' end)
    if ok then
        local rok, lib = pcall(require, 'luamemoryhelper')
        if rok and lib then memhelp_ok = true; memhelp = lib end
    end
end
local act_queue = {}   -- packet-based actions (trades, delivery, bazaar, seqack): throttled
local move_queue = {}  -- plain item moves + stack merges: throttleless, drained in bursts
local act_t = 0

move_dirty_bags = {}
function mark_move_dirty(to_bag)
    if not settings.auto_sort_on_move then return end
    if type(to_bag) ~= 'number' or to_bag < 0 then return end
    move_dirty_bags[to_bag] = true
end
local ACT_DELAY = 0.5
local MOVE_BURST = 24 -- item moves drained per frame from move_queue; the rest carry to the next
-- Item moves go in their own lane so they never wait behind a throttled packet action.
local function enqueue_fast(fn) move_queue[#move_queue + 1] = fn end

-- Organize moves must be PACED, not bursted. FFXI applies an inventory move via a
-- request/ack round-trip and silently drops a move fired before the prior one acks.
-- Bursting a whole plan made the game land only the FIRST move while the addon still
-- counted them all as moved (report said "8 moved", one really landed, the other 7
-- reappeared next run). One org move per ORG_MOVE_DELAY fixes it. Bump the delay if
-- the verify log still shows drops.
ORG_MOVE_DELAY = 0.25
org_move_queue = {}
org_move_t = 0
function enqueue_org(fn) org_move_queue[#org_move_queue + 1] = fn end

drop_q = {}
local drop_t = 0
drop_delay = 0
local INSTANT_CAP = 40
local drop_done = 0
drop_report = {}
pool_q = {}
pool_queued = {}
local org_active = false
local org_report_t = 0
local org_stream_t = 0
local org_total = 0
local org_done = 0
local org_moved = 0
org_debug = false
org_verify = nil  -- on a real run: { steps, moved, total, done_at }, verified after a settle delay

local slips_ok, slips_lib = pcall(require, 'slips')
local pool = {}
local pool_dirty = false
local pool_dirty_at = 0
local pool_rules = { lot = {}, pass = {}, drop = {} }
pool_lotqty = {}   -- item id -> target held count; auto-lot stops once resupply_count(id) reaches it
pool_pass_on_lot = false
pool_autolot_on = true -- master switch for acting on the lot list; toggled by desktop or //ax autolot
my_lotted = {}
local slips_dirty = false
local slips_dirty_at = 0
local slips_first_dirty = 0

local function esc(s)
    s = tostring(s or '')
    return (s:gsub('\\', '\\\\'):gsub('"', '\\"'):gsub('[\r\n\t]', ' '))
end

silent_cat = { action = false, progress = false, error = false }
AX_RCOL = string.char(0x1E, 0x01)
function ax_color_code(n)
    n = tonumber(n) or 1
    if n >= 256 and n < 509 then
        local m = n - 254
        if m == 4 then m = 3 end
        return string.char(0x1E, m)
    elseif n >= 1 and n <= 255 then
        return string.char(0x1F, n)
    end
    return string.char(0x1F, 1)
end
function ax_col(text, n)
    text = tostring(text or '')
    if not n or n == 0 then return text end
    local c = ax_color_code(n)
    return c .. text:gsub(' ', AX_RCOL .. ' ' .. c) .. AX_RCOL
end

ALEX_TAG_COLOR = 219
ALEX_BODY = 1
function alex_chat(color, text, cat)
    if cat and silent_cat[cat] then return end
    local tag, rest = text:match('^(%[[^%]]+%])(.*)$')
    local out = tag and (ax_col(tag, ALEX_TAG_COLOR) .. rest) or text
    windower.add_to_chat(1, out)
end

AX_BAG_COLOR = {
    ['inventory'] = 205, ['safe'] = 208, ['safe 2'] = 209, ['storage'] = 210, ['locker'] = 213,
    ['satchel'] = 259, ['sack'] = 324, ['case'] = 262, ['wardrobe'] = 256, ['wardrobe 2'] = 364, ['wardrobe 3'] = 326,
    ['wardrobe 4'] = 342, ['wardrobe 5'] = 340, ['wardrobe 6'] = 367, ['wardrobe 7'] = 363, ['wardrobe 8'] = 8,
}
function ax_bag_color(bag)
    return AX_BAG_COLOR[bag:lower()] or ALEX_BODY
end
AX_ECHO_COLOR = { price = 200, stock = 210, rate = 213 }
function ax_colorize(text)
    if text:find('{%w+|') then
        return (text:gsub('{(%w+)|([^}]*)}', function(tag, s)
            local n = AX_ECHO_COLOR[tag:lower()] or tonumber(tag)
            return n and ax_col(s, n) or s
        end))
    end
    local nm, bag, item = text:match('^([^/]+)/([^:]+): (.+)$')
    if not nm then return text end
    return nm .. '/' .. ax_col(bag, ax_bag_color(bag)) .. ': ' .. item
end

function build_keyitems()
    local ok, list = pcall(windower.ffxi.get_key_items)
    if not ok or type(list) ~= 'table' then return '{"t":"keyitems","items":[]}\n' end
    local parts = {}
    for _, id in ipairs(list) do
        local r = res.key_items[id]
        parts[#parts + 1] = '{"id":' .. id .. ',"n":"' .. esc((r and r.en) or ('Key Item ' .. id)) .. '"}'
    end
    return '{"t":"keyitems","items":[' .. table.concat(parts, ',') .. ']}\n'
end

local TXBUF_MAX = 524288
local function queue_send(data)
    if data and #txbuf < TXBUF_MAX then txbuf = txbuf .. data end
    if data and sage_connected and #sage_txbuf < TXBUF_MAX then sage_txbuf = sage_txbuf .. data end
end

function ah_extract_all_icons()
    if not icon_ok then return end
    local n = 0
    for id in pairs(res.items) do
        local i = tonumber(id)
        if i and i > 0 and not icon_queue[i]
            and not (windower.file_exists and windower.file_exists(icon_prefix .. i .. '.bmp')) then
            icon_queue[i] = true
            n = n + 1
        end
    end
    icon_bulk = true
    icon_bulk_total = n
    icon_bulk_t = os.clock()
    queue_send('{"t":"iconjob","done":0,"total":' .. n .. ',"running":true}\n')
end

local function bag_name(id)
    return res.bags[id] and res.bags[id].en or tostring(id)
end

local function build_self(kind)
    local p = windower.ffxi.get_player()
    if not p then return nil end
    local info = windower.ffxi.get_info()
    local zone_id = (info and info.zone) or 0
    if info and not info.mog_house and zone_id ~= 0 then last_open_zone = zone_id end
    local zone_name = res.zones[zone_id] and res.zones[zone_id].en or ''
    local me = windower.ffxi.get_mob_by_id(p.id)
    local px = (me and me.x) or 0
    local py = (me and me.y) or 0
    local server_name = (info and info.server and res.servers[info.server] and res.servers[info.server].en) or ''
    local gil = 0
    local ok_g, gitems = pcall(windower.ffxi.get_items)
    if ok_g and gitems and gitems.gil then gil = gitems.gil end
    local parts = {
        '"t":"' .. kind .. '"',
        '"id":' .. tostring(p.id or 0),
        '"name":"' .. esc(p.name) .. '"',
        '"main":"' .. esc(p.main_job) .. '"',
        '"main_lvl":' .. tostring(p.main_job_level or 0),
        '"sub":"' .. esc(p.sub_job) .. '"',
        '"sub_lvl":' .. tostring(p.sub_job_level or 0),
        '"zone":' .. tostring(zone_id),
        '"zone_name":"' .. esc(zone_name) .. '"',
        '"px":' .. string.format('%.2f', px),
        '"py":' .. string.format('%.2f', py),
        '"assets":"' .. esc(icon_dir) .. '"',
        '"apath":"' .. esc(windower.addon_path) .. '"',
        '"av":"' .. esc(_addon.version) .. '"',
        '"atah":' .. ((ah_at_ah(zone_id) or (info and info.mog_house and ah_at_ah(last_open_zone))) and 'true' or 'false'),
        '"in_town":' .. (TOWN_ZONES[zone_id] and 'true' or 'false'),
        '"server":"' .. esc(server_name) .. '"',
        '"gil":' .. tostring(gil),
        '"mog":' .. ((info and info.mog_house) and 'true' or 'false'),
        '"nomad_near":' .. (nomad_near and 'true' or 'false'),
    }
    return '{' .. table.concat(parts, ',') .. '}\n'
end

local flag_cache = {}
local function item_flags(id)
    local m = flag_cache[id]
    if m ~= nil then return m end
    m = 0
    local r = res.items[id]
    if r then
        local isset = {}
        if type(r.flags) == 'table' then for nm in pairs(r.flags) do isset[nm] = true end end
        if isset['Rare'] then m = m + 1 end
        if isset['Exclusive'] or isset['No PC Trade'] then m = m + 2 end
        if (r.stack or 1) <= 1 then m = m + 4 end
        if isset['No Auction'] or isset['Exclusive'] then m = m + 8 end
        if isset['No NPC Sale'] then m = m + 16 end
        if isset['No Delivery'] then m = m + 32 end
    end
    flag_cache[id] = m
    return m
end

local function decode_item_augments(it)
    if not extdata_ok or not extdata or type(it) ~= 'table' or type(it.extdata) ~= 'string' or #it.extdata ~= 24 then return nil end
    local ok, dec = pcall(extdata.decode, it)
    if not ok or type(dec) ~= 'table' or type(dec.augments) ~= 'table' then return nil end
    local rank = (type(dec.rank) == 'number' and dec.rank > 0) and dec.rank or nil
    local out = {}
    for _, a in ipairs(dec.augments) do
        if type(a) == 'string' and a ~= '' and a:lower() ~= 'none' then
            if rank and a:match('^Path:') then a = a .. ' (R' .. tostring(rank) .. ')' end
            out[#out + 1] = a
        end
    end
    return (#out > 0) and out or nil
end

inv_sig_last = nil
function inv_signature()
    local h = 5381
    for bag_id in pairs(res.bags) do
        local items = windower.ffxi.get_items(bag_id)
        if type(items) == 'table' then
            for s = 1, (items.max or 0) do
                local it = items[s]
                if it and it.id and it.id ~= 0 then
                    local c = it.count or 0
                    h = (h * 131 + bag_id * 97 + s * 7 + it.id + c) % 2147483647
                    local ext = it.extdata
                    if ext and c <= 1 then
                        for i = 1, #ext do h = (h * 131 + ext:byte(i)) % 2147483647 end
                    end
                end
            end
        end
    end
    return h
end

local function build_inventory()
    -- Stamp the report with the owning character's id so the desktop can reject one that
    -- raced ahead of the identity feed on a shared-client swap. No player (mid login/logout)
    -- means nothing trustworthy to report -- skip it so a partial unload never overwrites a
    -- good snapshot.
    local p = windower.ffxi.get_player()
    if not p then return nil end
    local pid = p.id or 0
    local bag_parts = {}
    for bag_id, bag in pairs(res.bags) do
        local items = windower.ffxi.get_items(bag_id)
        -- Like findAll: show a storage bag whenever it holds items -- do NOT gate on
        -- `enabled`. The Mog House bags -- Safe (1), Storage (2), Locker (4), Safe 2
        -- (9) -- and Temporary (3) report enabled=false whenever you aren't standing
        -- at a Mog House / Nomad Moogle, yet their cached contents are still readable.
        -- Gating on `enabled` hid Storage AND the Locker for anyone in the field (the
        -- 0.0.17 bug). Satchel/Sack/Case/Wardrobes are enabled everywhere, so they
        -- keep the enabled check.
        local fallback_bag = (bag_id == 1 or bag_id == 2 or bag_id == 3 or bag_id == 4 or bag_id == 9)
        if type(items) == 'table' and (items.enabled or bag_id == 17 or (fallback_bag and (items.count or 0) > 0)) then
            local slot_parts = {}
            local maxn = items.max or 0
            for s = 1, maxn do
                local it = items[s]
                if it and it.id and it.id ~= 0 then
                    local r = res.items[it.id]
                    local name = (r and r.en) or ('Item ' .. it.id)
                    queue_icon(it.id)
                    local usable = (r and r.targets and r.targets.Self) and ',"u":1' or ''
                    local ff = item_flags(it.id)
                    local fpart = ff > 0 and (',"f":' .. ff) or ''
                    local mspart = (r and r.stack and r.stack > 1) and (',"ms":' .. r.stack) or ''
                    local augpart = ''
                    local augs = decode_item_augments(it)
                    if augs then
                        local ap = {}
                        for _, a in ipairs(augs) do ap[#ap + 1] = '"' .. esc(a) .. '"' end
                        augpart = ',"aug":[' .. table.concat(ap, ',') .. ']'
                    end
                    local bzpart = (it.bazaar and it.bazaar > 0) and (',"bz":' .. it.bazaar) or ''  -- a nonzero bazaar price means it's listed on your bazaar
                    local lkpart = (it.status and it.status ~= 0) and ',"lk":1' or ''  -- locked: equipped/bazaar/etc, can't be freely moved
                    slot_parts[#slot_parts + 1] =
                        '{"s":' .. s .. ',"id":' .. it.id .. ',"c":' .. (it.count or 1) .. ',"n":"' .. esc(name) .. '"' .. usable .. fpart .. mspart .. augpart .. bzpart .. lkpart .. '}'
                end
            end
            local bname = bag.en or bag.english or bag.command or tostring(bag_id)
            bag_parts[#bag_parts + 1] =
                '{"b":"' .. esc(bname) .. '","id":' .. bag_id .. ',"max":' .. maxn ..
                ',"used":' .. #slot_parts .. ',"items":[' .. table.concat(slot_parts, ',') .. ']}'
        end
    end
    return '{"t":"inv","id":' .. pid .. ',"bags":[' .. table.concat(bag_parts, ',') .. ']}\n'
end

local function build_pool()
    local lots = nil
    local party = windower.ffxi.get_party()
    if party and party.p0 then lots = party.p0.lots end
    -- One pass over the carry bags (inventory + satchel/sack/case + wardrobes): how many of each item id
    -- this character holds. Feeds Sage's overlay "Owns (Rare)" lot guard + the held x N annotation without a
    -- get_items call per pool item. Bag list is inlined to avoid adding a main-chunk local (200-limit).
    local held = {}
    for _, bag in ipairs({ 0, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16 }) do
        local items = windower.ffxi.get_items(bag)
        if type(items) == 'table' then
            for s = 1, (items.max or 80) do
                local it = items[s]
                if type(it) == 'table' and it.id and it.id ~= 0 then held[it.id] = (held[it.id] or 0) + (it.count or 0) end
            end
        end
    end
    local parts = {}
    for i = 0, 9 do
        local p = pool[i]
        if p then
            local name = res.items[p.id] and res.items[p.id].en or ('Item ' .. p.id)
            queue_icon(p.id)
            local mylot = lots and lots[i]
            local mylot_s = (type(mylot) == 'number') and tostring(mylot) or 'null'
            local lotter_s = p.lotter and ('"' .. esc(p.lotter) .. '"') or 'null'
            parts[#parts + 1] = '{"i":' .. i .. ',"id":' .. p.id .. ',"n":"' .. esc(name) ..
                '","ts":' .. (p.ts or 0) .. ',"lotter":' .. lotter_s .. ',"lot":' .. (p.lot or 0) ..
                ',"mylot":' .. mylot_s .. ',"held":' .. (held[p.id] or 0) .. ',"f":' .. item_flags(p.id) .. '}'
        end
    end
    return '{"t":"pool","items":[' .. table.concat(parts, ',') .. ']}\n'
end

party_key = nil
party_check_t = 0
function build_party()
    local party = windower.ffxi.get_party()
    local names = {}
    if party then
        for _, pre in ipairs({ 'p', 'a1', 'a2' }) do
            for i = 0, 5 do
                local m = party[pre .. i]
                if type(m) == 'table' and m.name and m.name ~= '' then names[#names + 1] = m.name end
            end
        end
    end
    table.sort(names)
    local jn = {}
    for _, n in ipairs(names) do jn[#jn + 1] = '"' .. esc(n) .. '"' end
    local key = table.concat(names, '|')
    return '{"t":"party","key":"' .. esc(key) .. '","members":[' .. table.concat(jn, ',') .. '],"size":' .. #names .. '}\n', key
end

local slip_cache = {}
slip_cache_loaded = false
slip_cache_sig = nil
function slip_cache_path()
    local p = windower.ffxi.get_player()
    if not p or not p.name then return nil end
    return windower.addon_path .. 'data/slipcache_' .. p.name:gsub('[^%w]', '') .. '.json'
end
function slip_cache_load()
    if slip_cache_loaded or not json_ok then return end
    local path = slip_cache_path()
    if not path then return end
    slip_cache_loaded = true
    local f = io.open(path, 'r')
    if not f then return end
    local raw = f:read('*a'); f:close()
    local ok, dec = pcall(json.decode, raw)
    if not (ok and type(dec) == 'table') then return end
    for k, e in pairs(dec) do
        local sid = tonumber(k)
        if sid and type(e) == 'table' then
            local st = {}
            if type(e.stored) == 'table' then for _, iid in ipairs(e.stored) do st[#st + 1] = tonumber(iid) end end
            slip_cache[sid] = { loc = tonumber(e.loc) or -1, stored = st }
        end
    end
    local ek, ev = pcall(json.encode, slip_cache)
    if ek then slip_cache_sig = ev end
end
function slip_cache_save()
    if not json_ok then return end
    local path = slip_cache_path()
    if not path then return end
    local ok, enc = pcall(json.encode, slip_cache)
    if not ok or enc == slip_cache_sig then return end
    slip_cache_sig = enc
    local f = io.open(path, 'w')
    if f then f:write(enc); f:close() end
end

local function build_slips()
    if not slips_ok then return '{"t":"slips","slips":[]}\n' end
    slip_cache_load()
    local ok, stored = pcall(slips_lib.get_player_items)
    if not ok then return '{"t":"slips","slips":[]}\n' end
    local storable = {}
    local slip_bag = {}
    for _, bag in pairs(res.bags) do
        local items = windower.ffxi.get_items(bag.id)
        if type(items) == 'table' and items.enabled then
            for s = 1, (items.max or 0) do
                local it = items[s]
                if it and it.id and it.id ~= 0 then
                    if slips_lib.items[it.id] then slip_bag[it.id] = bag.id end
                    local sid = slips_lib.get_slip_id_by_item_id(it.id)
                    -- Only offer gear that is actually free to store: skip equipped (5) / bazaared (25) pieces,
                    -- which the game refuses to move anyway. Without this the count and Store-for-job list
                    -- include the gear you are wearing.
                    if sid and (it.status == nil or it.status == 0) then
                        storable[sid] = storable[sid] or {}
                        storable[sid][it.id] = (storable[sid][it.id] or 0) + (it.count or 1)
                    end
                end
            end
        end
    end
    -- Remember location + contents of any slip we can read right now, so we can
    -- still report where a slip is (e.g. Mog Safe) when we later can't access it.
    for sid, bag in pairs(slip_bag) do
        local st = {}
        if stored[sid] then for _, iid in ipairs(stored[sid]) do st[#st + 1] = iid end end
        slip_cache[sid] = { loc = bag, stored = st }
    end
    slip_cache_save()
    local parts = {}
    for _, sid in ipairs(slips_lib.storages) do
        local bag = slip_bag[sid]
        local cache = slip_cache[sid]
        -- Only report a slip this character genuinely owns: either its physical slip
        -- item is in a readable (per-character) bag right now (slip_bag, gated on
        -- enabled), or we cached it from such a bag before. slips_lib.get_player_items
        -- also reads Mog Safe/Storage/Locker, whose buffer on a shared POL client can
        -- still hold the MAIN's slip items -- reading those leaked the main's slip
        -- contents onto the mule. slip_bag/cache never hold leaked slips (per-character bags).
        local trusted = (bag ~= nil) or (cache ~= nil)
        local live = trusted and stored[sid] or nil
        local show = (live and #live > 0) and live or (cache and cache.stored) or {}
        local sa = storable[sid]
        -- Show a slip when this character owns it (trusted -> may show stored contents), OR when
        -- the character is merely holding items that belong on it (sa) even without owning the
        -- slip. The storable list (sa) is built only from enabled per-character bags, so an
        -- unowned slip never leaks another character's stored contents (show is empty when not
        -- trusted); it just tells you "you have items for this, go grab the slip".
        if #show > 0 or sa then
            local num = slips_lib.get_slip_number_by_id(sid) or 0
            local name = res.items[sid] and res.items[sid].en or ('Slip ' .. num)
            local loc = bag or (cache and cache.loc) or -1
            local locname = (loc >= 0 and res.bags[loc] and res.bags[loc].en) or ''
            local ready = bag == 0
            local getable = bag ~= nil and bag ~= 0
            local owned = trusted
            local sp = {}
            for _, iid in ipairs(show) do
                local nm = res.items[iid] and res.items[iid].en or ('Item ' .. iid)
                queue_icon(iid)
                sp[#sp + 1] = '{"id":' .. iid .. ',"n":"' .. esc(nm) .. '"}'
            end
            local ap = {}
            if sa then for iid, c in pairs(sa) do
                local nm = res.items[iid] and res.items[iid].en or ('Item ' .. iid)
                queue_icon(iid)
                ap[#ap + 1] = '{"id":' .. iid .. ',"n":"' .. esc(nm) .. '","c":' .. c .. '}'
            end end
            parts[#parts + 1] = '{"sid":' .. sid .. ',"num":' .. num .. ',"name":"' .. esc(name) ..
                '","ready":' .. (ready and 'true' or 'false') ..
                ',"getable":' .. (getable and 'true' or 'false') ..
                ',"owned":' .. (owned and 'true' or 'false') ..
                ',"loc":' .. loc .. ',"locname":"' .. esc(locname) .. '"' ..
                ',"stored":[' .. table.concat(sp, ',') .. '],"storable":[' .. table.concat(ap, ',') .. ']}'
        end
    end
    return '{"t":"slips","slips":[' .. table.concat(parts, ',') .. ']}\n'
end

-- ===== Porter Moogle (store/retrieve), ported from PorterPacker by Ivaar =====
local PO_ZONES = {
    [26] = 621, [50] = 959, [53] = 330, [80] = 661, [87] = 603, [94] = 525, [231] = 874,
    [235] = 547, [240] = 870, [245] = 10106, [247] = 138, [248] = 1139, [249] = 338,
    [250] = 309, [252] = 246, [256] = 43, [280] = 802,
}
po_state = 0
po_store = {}
po_retrieve = {}
po_storing = false
po_last_update = nil
po_progress = nil
po_progress_dirty = false
po_consolidate_state = nil
po_return_slips = {}   -- slip sid -> origin bag we pulled it from, to put back after the op
porter_near = false
porter_near_dirty = false
sparks_near = false
unity_near = false
curio_near = false
vendor_near_dirty = false

local function po_space(bag_id)
    local bag = windower.ffxi.get_bag_info(bag_id)
    return (bag and bag.enabled) and (bag.max - bag.count) or 0
end

local function po_find_item(bags, item_id, count)
    for _, bag_name in pairs(bags) do
        for _, item in ipairs(windower.ffxi.get_items(bag_name)) do
            if item.id == item_id and item.count >= count and item.status == 0 then return item end
        end
    end
    return nil
end

-- Find an item in any accessible NON-inventory bag (wardrobe, satchel, etc.).
local function po_item_bag(id)
    for _, bag in pairs(res.bags) do
        if bag.id ~= 0 then
            local items = windower.ffxi.get_items(bag.id)
            if type(items) == 'table' and items.enabled then
                for s = 1, (items.max or 0) do
                    local it = items[s]
                    if it and it.id == id and it.id ~= 0 and it.status == 0 then return bag.id, s, it.count or 1 end
                end
            end
        end
    end
    return nil
end

-- Pull every needed item into inventory first (Porter trades only from bag 0),
-- then run cb once they have all arrived (or a timeout).
local function po_consolidate(need, cb)
    local waiting = {}
    for id in pairs(need) do
        if not po_find_item({ 'inventory' }, id, 1) then
            local bag, slot, count = po_item_bag(id)
            if bag and po_space(0) > 0 then
                pcall(windower.ffxi.get_item, bag, slot, count)
                waiting[id] = true
                if slips_lib.items[id] and bag ~= 0 then po_return_slips[id] = bag end -- a slip we pulled in; put it back after
            end
        end
    end
    if next(waiting) then
        po_consolidate_state = { waiting = waiting, cb = cb, t = os.clock() }
    else
        cb()
    end
end

local function po_find_npc()
    local npc = windower.ffxi.get_mob_by_name('Porter Moogle')
    if npc and npc.distance and math.sqrt(npc.distance) < 6 then return npc end
    return nil
end

local function po_trade_npc(npc, items)
    local fields = { ['Target'] = npc.id, ['Target Index'] = npc.index, ['Number of Items'] = math.min(#items, 8) }
    for i = 1, 8 do
        fields['Item Count ' .. i] = items[i] and items[i].count or 0
        fields['Item Index ' .. i] = items[i] and (items[i].slot or items[i].index) or 0
    end
    pcall(packets.inject, packets.new('outgoing', 0x036, fields))
    po_state = 1
end

local function po_find_porter_items(bag)
    local slip_tables = {}
    local filter = next(po_store) and po_store or nil
    for _, item in ipairs(windower.ffxi.get_items(bag)) do
        if item.id ~= 0 and item.status == 0 then
            local slip_id = slips_lib.get_slip_id_by_item_id(item.id)
            if slip_id and not slips_lib.player_has_item(item.id) and
                (not filter or filter[item.id]) and not po_retrieve[item.id] and
                (slip_id ~= slips_lib.storages[13] and item.extdata:byte(1) ~= 2 or item.extdata:byte(2) % 0x80 >= 0x40 and item.extdata:byte(12) >= 0x80) then
                slip_tables[slip_id] = slip_tables[slip_id] or {}
                slip_tables[slip_id][#slip_tables[slip_id] + 1] = item
            elseif slips_lib.items[item.id] then
                slip_tables[item.id] = slip_tables[item.id] or {}
                table.insert(slip_tables[item.id], 1, item)
            end
        end
    end
    return slip_tables
end

local function po_porter_trade()
    if not packets_ok or not slips_ok then return end
    local npc = po_find_npc()
    if not npc then
        po_retrieve = {}; po_store = {}; po_storing = false
        alex_chat(207, '[Alexandria] Porter Moogle not in range', 'error')
        return
    end
    if po_storing then
        for slip_id, items in pairs(po_find_porter_items(0)) do
            if #items > 1 and items[1].id == slip_id then
                return po_trade_npc(npc, items)
            end
        end
        po_store = {}; po_storing = false
    end
    if next(po_retrieve) and po_space(0) ~= 0 then
        for slip_id, items in pairs(slips_lib.get_player_items()) do
            for _, item_id in ipairs(items) do
                if po_retrieve[item_id] and not po_find_item(slips_lib.default_storages, item_id, 1) then
                    local slip_item = po_find_item({ slips_lib.default_storages[1] }, slip_id, 1)
                    if slip_item then return po_trade_npc(npc, { slip_item }) end
                end
            end
        end
    end
    po_retrieve = {}
end

local function po_inject_option(npc_id, npc_index, zone_id, menu_id, option_index, bool)
    windower.packets.inject_outgoing(0x5B, ('I3H4'):pack(0, npc_id, option_index, npc_index, bool, zone_id, menu_id))
    return true
end

local function po_porter_store(data)
    if data:byte(0x0C + 1) == 0 then
        return data:sub(0x00 + 1, 0x07 + 1) .. string.char(1, 0, 0, 0, 1) .. data:sub(0x0D + 1)
    end
    return false
end

local function po_porter_retrieve(data, update, zone_id, menu_id)
    local npc_id = data:unpack('I', 0x04 + 1)
    local npc_index = data:unpack('H', 0x28 + 1)
    if po_space(0) ~= 0 then
        local option_index = 0
        local stored_items = update and update:sub(0x04 + 1, 0x1B + 1) or data:sub(0x08 + 1, 0x1F + 1)
        local slip_number = data:unpack('I', 0x24 + 1) + 1
        for bit_position = 0, 191 do
            if stored_items:unpack('b', math.floor(bit_position / 8) + 1, bit_position % 8 + 1) == 1 then
                local item_id = slips_lib.items[slips_lib.storages[slip_number]][bit_position + 1]
                if item_id and po_retrieve[item_id] then
                    if update and bit_position == update:unpack('I', 0x2A + 1) then
                        po_retrieve[item_id] = nil
                    else
                        return po_inject_option(npc_id, npc_index, zone_id, menu_id, option_index, 1)
                    end
                end
                option_index = option_index + 1
            end
        end
    end
    po_state = 3
    return po_inject_option(npc_id, npc_index, zone_id, menu_id, 0x40000000, 0)
end

local PO_EVENTS = {}
for zid, v in pairs(PO_ZONES) do
    PO_EVENTS[zid] = { [v - 1] = po_porter_store, [v] = po_porter_retrieve }
end

local function po_check_event(data, update)
    local zone_id, menu_id = data:unpack('H2', 0x2A + 1)
    if PO_EVENTS[zone_id] and PO_EVENTS[zone_id][menu_id] then
        if update and update == po_last_update then return true end
        po_state = 2
        po_last_update = update
        return PO_EVENTS[zone_id][menu_id](data, update, zone_id, menu_id)
    end
    return false
end

local function po_progress_update()
    if not po_progress then return end
    local done = 0
    for id in pairs(po_progress.ids) do
        if po_progress.op == 'store' then
            if slips_lib.player_has_item(id) then done = done + 1 end
        elseif po_find_item(slips_lib.default_storages, id, 1) then
            done = done + 1
        end
    end
    po_progress.done = done
    po_progress_dirty = true
end

-- After a store/retrieve, put every slip we had to pull into inventory back where it came from, so bulk ops
-- do not leave the slips scattered in inventory.
function po_return_slips_now()
    if not next(po_return_slips) then return end
    for sid, origin in pairs(po_return_slips) do
        local s_sid, s_origin = sid, origin
        enqueue_fast(function()
            local items = windower.ffxi.get_items(0)
            if type(items) ~= 'table' then return end
            for s = 1, (items.max or 0) do
                local it = items[s]
                if it and it.id == s_sid and it.id ~= 0 and (it.status == nil or it.status == 0) then
                    pcall(windower.ffxi.move_item, 0, s_origin, it.slot or s, 1)
                    return
                end
            end
        end)
    end
    po_return_slips = {}
end

local function po_progress_done()
    if po_progress and po_progress.active then
        po_progress.active = false
        po_progress_dirty = true
    end
    po_return_slips_now()
end

local function po_release_event(data, release)
    local zone_id, menu_id = data:unpack('H2', 0x2A + 1)
    if menu_id == release:unpack('H', 0x05 + 1) then
        local npc_id = data:unpack('I', 0x04 + 1)
        local npc_index = data:unpack('H', 0x28 + 1)
        po_inject_option(npc_id, npc_index, zone_id, menu_id, 0x40000000, 0)
        po_state = 0; po_last_update = nil
        po_retrieve = {}; po_store = {}; po_storing = false
        po_progress_update()
        po_progress_done()
    end
end

function po_incoming(id, data)
    if id == 0x034 and po_state == 1 then
        return po_check_event(data)
    elseif id == 0x05C and po_state == 2 then
        po_check_event(windower.packets.last_incoming(0x34), data)
    elseif id == 0x052 and po_state ~= 0 then
        if po_state == 3 then
            po_state = 0; po_last_update = nil
            po_porter_trade()
            po_progress_update()
            if po_state == 0 then po_progress_done() end
        elseif po_state == 2 and data:byte(0x04 + 1) == 2 then
            po_release_event(windower.packets.last_incoming(0x34), data)
        end
    end
end

local function po_busy()
    if po_state ~= 0 or po_consolidate_state then return true end
    local p = windower.ffxi.get_player()
    return p and p.status ~= 0
end

local function po_start_progress(op, ids)
    local idset, n = {}, 0
    for _, id in ipairs(ids) do idset[tonumber(id)] = true; n = n + 1 end
    po_progress = { op = op, ids = idset, total = n, done = 0, active = true }
    po_progress_dirty = true
end

function po_run_store(ids)
    if po_busy() then alex_chat(207, '[Alexandria] Porter busy, try again in a moment', 'error') return end
    local need = {}
    for _, id in ipairs(ids) do
        local n = tonumber(id)
        need[n] = true
        local sid = slips_lib.get_slip_id_by_item_id(n)
        if sid then need[sid] = true end
    end
    po_start_progress('store', ids)
    po_consolidate(need, function()
        po_store = {}
        for _, id in ipairs(ids) do po_store[tonumber(id)] = true end
        po_retrieve = {}
        po_storing = true
        po_porter_trade()
        if po_state == 0 then po_progress_done() end
    end)
end

function po_run_retrieve(ids)
    if po_busy() then alex_chat(207, '[Alexandria] Porter busy, try again in a moment', 'error') return end
    local need = {}
    for _, id in ipairs(ids) do
        local sid = slips_lib.get_slip_id_by_item_id(tonumber(id))
        if sid then need[sid] = true end
    end
    po_start_progress('retrieve', ids)
    po_consolidate(need, function()
        po_retrieve = {}
        for _, id in ipairs(ids) do po_retrieve[tonumber(id)] = true end
        po_store = {}
        po_storing = false
        po_porter_trade()
        if po_state == 0 then po_progress_done() end
    end)
end

function build_porter()
    if not po_progress then return '{"t":"porter","active":false}\n' end
    return '{"t":"porter","active":' .. (po_progress.active and 'true' or 'false') ..
        ',"op":"' .. po_progress.op .. '","total":' .. po_progress.total .. ',"done":' .. po_progress.done .. '}\n'
end

local function pool_check(index, id)
    local r = pool_rules
    if (r.drop[id] or r.pass[id]) and not r.lot[id] then
        enqueue_pool(index, 'pass')
    elseif r.lot[id] then
        if not pool_autolot_on then return end
        if resupply_is_rare(id) and resupply_count(id) >= 1 then return end
        if pool_lotqty[id] and resupply_count(id) >= pool_lotqty[id] then return end -- quantity target reached; stop lotting
        local inv = windower.ffxi.get_bag_info(0)
        if inv and (inv.max - inv.count) > 1 then
            enqueue_pool(index, 'lot')
        end
    end
end

function pool_ipc_pass(index)
    if not pool_pass_on_lot then return end
    if index == nil or my_lotted[index] then return end
    pcall(windower.ffxi.pass_item, index)
end

local function disconnect()
    if conn then pcall(function() conn:close() end) end
    conn = nil
    connected = false
    rx = ''
    txbuf = ''
    if conn_pending then pcall(function() conn_pending:close() end) conn_pending = nil end
    retry_delay = RETRY_INTERVAL
end

local function find_in_bag(bag_id, item_id, limit)
    local items = windower.ffxi.get_items(bag_id)
    if type(items) ~= 'table' then return nil end
    local maxn = items.max or 0
    for s = 1, maxn do
        local it = items[s]
        -- Skip locked slots (equipped = 5, on bazaar = 25); the game refuses to
        -- move them, so returning one just makes the caller spin on it.
        if it and it.id == item_id and it.id ~= 0 and (it.status == nil or it.status == 0) then
            local take = it.count or 1
            if limit and take > limit then take = limit end
            return { slot = it.slot or s, count = take }
        end
    end
    return nil
end

local function enqueue_move(id, from_bag, to_bag, remaining)
    mark_move_dirty(to_bag)
    -- Resolve every source slot from ONE snapshot and queue a distinct move per slot.
    -- The old recursive re-read was unsafe on the fast burst: a move takes a frame or
    -- two to reflect, so re-reading get_items mid burst saw the same slot still full
    -- and moved it again, colliding on one slot and burning down `remaining` without
    -- moving the rest (only ~1 stack actually landed). Mirrors enqueue_org_move.
    local items = windower.ffxi.get_items(from_bag)
    if type(items) ~= 'table' then return end
    local di = windower.ffxi.get_bag_info(to_bag)
    local free = di and (di.max - di.count) or 999
    local moves = {}
    for s = 1, (items.max or 0) do
        if remaining <= 0 or free <= 0 then break end
        local it = items[s]
        -- Skip locked slots (equipped = 5, on bazaar = 25); the game refuses them.
        if it and it.id == id and it.id ~= 0 and (it.status == nil or it.status == 0) then
            local take = math.min(it.count or 1, remaining)
            moves[#moves + 1] = { slot = it.slot or s, count = take }
            remaining = remaining - take
            free = free - 1 -- worst case each stack claims a fresh dest slot; merges only free more
        end
    end
    for _, mv in ipairs(moves) do
        local fb, tb, slot, count = from_bag, to_bag, mv.slot, mv.count
        enqueue_fast(function() windower.ffxi.move_item(fb, tb, slot, count) end)
    end
end

local function enqueue_move_exact(id, from_bag, to_bag, slot, count)
    mark_move_dirty(to_bag)
    enqueue_fast(function()
        local di = windower.ffxi.get_bag_info(to_bag)
        if di and (di.max - di.count) <= 0 then return end
        local items = windower.ffxi.get_items(from_bag)
        local it = items and type(items) == 'table' and items[slot]
        if not (type(it) == 'table' and it.id == id and it.id ~= 0) then
            alex_chat(207, '[Alexandria] item no longer in that slot; move skipped', 'error')
            return
        end
        if (it.status or 0) ~= 0 then  -- bazaared (25) / equipped items can't be moved
            alex_chat(207, '[Alexandria] item is bazaared or equipped; move skipped', 'error')
            return
        end
        windower.ffxi.move_item(from_bag, to_bag, it.slot or slot, math.min(count or (it.count or 1), it.count or 1))
    end)
end

local function enqueue_stack(bag)
    if bag then
        enqueue_fast(function() windower.ffxi.stack_items(bag) end)
    else
        for _, b in pairs(res.bags) do
            local info = windower.ffxi.get_bag_info(b.id)
            if info and info.enabled then
                local bid = b.id
                enqueue_fast(function() windower.ffxi.stack_items(bid) end)
            end
        end
    end
end

local name_to_id_cache = nil
name_to_ids_cache = nil   -- GLOBAL (kept off the main-chunk local cap): name -> { EVERY id sharing it }.
-- Relic/mythic/empyrean weapons reuse one name across ~10 upgrade-tier ids (Apocalypse, Tizona, Aegis...).
-- A name->single-id map lands a name-keyed rule (layout/keepQty/alwaysBring) on the last-seen tier, not the
-- one the player owns, so their copy is silently unrouted. Resolve a name to ALL its ids instead.
local function build_name_index()
    if name_to_id_cache then return name_to_id_cache end
    name_to_id_cache = {}
    name_to_ids_cache = {}
    for id, item in pairs(res.items) do
        local a = item.enl and item.enl:lower()
        local b = item.en and item.en:lower()
        if a then
            name_to_id_cache[a] = id
            local l = name_to_ids_cache[a]; if not l then l = {}; name_to_ids_cache[a] = l end; l[#l + 1] = id
        end
        if b then
            name_to_id_cache[b] = id
            if b ~= a then local l = name_to_ids_cache[b]; if not l then l = {}; name_to_ids_cache[b] = l end; l[#l + 1] = id end
        end
    end
    return name_to_id_cache
end

TREASURE_GROUPS = {
    seals = { 1126, 1127, 2955, 2956, 2957 },
    currency = { 1449, 1450, 1451, 1452, 1453, 1454, 1455, 1456, 1457 },
    geodes = { 3297, 3298, 3299, 3300, 3301, 3302, 3303, 3304 },
    avatarites = { 3520, 3521, 3522, 3523, 3524, 3525, 3526, 3527 },
    crystals = { 4096, 4097, 4098, 4099, 4100, 4101, 4102, 4103 },
    detritus = { 9875, 9876 },
    heroism = { 9877, 9878 },
    moldy = { 9773, 9830, 9831, 9832, 9833, 9834, 9835, 9836, 9837, 9838, 9839, 9840, 9841, 9843, 9868, 9869, 9870, 9871, 9872, 9873, 9874 },
    dynad = { 9538, 9539, 9540, 9541, 9542, 9543, 9844, 9845 },
    papers = { 9544, 9545, 9546, 9547, 9548, 9549, 9550, 9551, 9552, 9553, 9554, 9555, 9556, 9557, 9558, 9559, 9560, 9561, 9562, 9563, 9564, 9565, 9566, 9567, 9568, 9569, 9570, 9571, 9572, 9573, 9574, 9575, 9576, 9577, 9578, 9579, 9580, 9581, 9582, 9583, 9584, 9585, 9586, 9587, 9588, 9589, 9590, 9591, 9592, 9593, 9594, 9595, 9596, 9597, 9598, 9599, 9600, 9601, 9602, 9603, 9604, 9605, 9606, 9607, 9608, 9609, 9610, 9611, 9612, 9613, 9614, 9615, 9616, 9617, 9618, 9619, 9620, 9621, 9622, 9623, 9624, 9625, 9626, 9627, 9628, 9629, 9630, 9631, 9632, 9633, 9634, 9635, 9636, 9637, 9638, 9639, 9640, 9641, 9642, 9643, 9644, 9645, 9646, 9647, 9648, 9649, 9650, 9651, 9652, 9653, 9654, 9655, 9656, 9657, 9658, 9659, 9660, 9661, 9662, 9663, 9664, 9665, 9666, 9667, 9668, 9669, 9670, 9671, 9672, 9673, 9674, 9675, 9676, 9677, 9678, 9679, 9680, 9681, 9682, 9683, 9684, 9685, 9686, 9687, 9688, 9689, 9690, 9691, 9692, 9693, 9694, 9695, 9696, 9697, 9698, 9699, 9700, 9701, 9702, 9703, 9704, 9705, 9706, 9707, 9708, 9709, 9710, 9711, 9712, 9713, 9714, 9715, 9716, 9717, 9718, 9719, 9720, 9721, 9722, 9723, 9724, 9725, 9726, 9727, 9728, 9729, 9730, 9731, 9732, 9733, 9734, 9735, 9736, 9737, 9738, 9739, 9740, 9741, 9742, 9743, 9744, 9745, 9746, 9747, 9748, 9749, 9750, 9751, 9752, 9753, 9754, 9755, 9756, 9757, 9758, 9759, 9760, 9761, 9762, 9763 },
}

local function name_glob_to_pattern(g)
    local p = tostring(g):lower():gsub('[%^%$%(%)%%%.%[%]%+%-%?]', '%%%0'):gsub('%*', '.*')
    return '^' .. p .. '$'
end

-- Resolve one name entry to item ids. A '*' makes it a wildcard that matches
-- every item whose English name fits, e.g. 'Toolbag (*' or 'Frayed Sack*'.
local function ids_for_name_entry(nm)
    local low = tostring(nm):lower()
    if not low:find('*', 1, true) then
        local grp = TREASURE_GROUPS[low]
        if grp then return grp end
        build_name_index()
        local all = name_to_ids_cache[low]
        if all and #all > 0 then return all end
        return {}
    end
    local pat = name_glob_to_pattern(low)
    local out = {}
    for id, item in pairs(res.items) do
        local n = item.en and item.en:lower()
        if n and n:match(pat) then out[#out + 1] = id end
    end
    return out
end

local function ids_for_names(names)
    local set = {}
    for _, nm in ipairs(names or {}) do
        for _, id in ipairs(ids_for_name_entry(nm)) do set[id] = true end
    end
    return set
end

-- Resolve a { name -> target count } map into { item id -> target count } for quantity-capped auto-lot.
function idqty_for_names(map)
    local out = {}
    if type(map) ~= 'table' then return out end
    for nm, qty in pairs(map) do
        local q = tonumber(qty)
        if q and q > 0 then for _, id in ipairs(ids_for_name_entry(nm)) do out[id] = q end end
    end
    return out
end

function enqueue_drop(slot, id)
    if drop_queued[slot] then return end
    drop_queued[slot] = true
    drop_q[#drop_q + 1] = { slot = slot, id = id }
end

function drop_amount(id, qty)
    local inv = windower.ffxi.get_items(0)
    if not inv then return end
    local remaining = qty
    for s = 1, (inv.max or 80) do
        if remaining <= 0 then break end
        local it = inv[s]
        if type(it) == 'table' and it.id == id and it.status == 0 and (it.count or 0) > 0 then
            local n = math.min(remaining, it.count)
            if packets_ok then
                packets.inject(packets.new('outgoing', 0x028, { ['Count'] = n, ['Bag'] = 0, ['Inventory Index'] = s }))
            else
                windower.ffxi.drop_item(s, n)
            end
            remaining = remaining - n
        end
    end
end

function drop_request(slot, id, from_bag, count)
    if not from_bag or from_bag == 0 then enqueue_drop(slot, id) return end
    drop_move_q[#drop_move_q + 1] = { bag = from_bag, slot = slot, id = id, count = count }
end

function pump_drop_moves()
    if drop_pending or #drop_move_q == 0 then return end
    local req = table.remove(drop_move_q, 1)
    local from_bag, slot, id, count = req.bag, req.slot, req.id, req.count
    local items = windower.ffxi.get_items(from_bag)
    local it = slot and type(items) == 'table' and items[slot]
    if not (type(it) == 'table' and it.id == id and it.id ~= 0) then
        local m = find_in_bag(from_bag, id, nil)
        if not m then alex_chat(207, '[Alexandria] item not found in that bag; drop skipped', 'error') return end
        slot = m.slot
        it = type(items) == 'table' and items[slot]
    end
    local di = windower.ffxi.get_bag_info(0)
    if di and (di.max - di.count) <= 0 then drop_move_q = {} alex_chat(207, '[Alexandria] inventory full; cannot move items to drop', 'error') return end
    local cap = (type(it) == 'table' and it.count) or 1
    local mv = math.min((count and count > 0 and count) or cap, cap)
    local before = shop_count_inv(id)
    windower.ffxi.move_item(from_bag, 0, slot, mv)
    drop_pending = { id = id, qty = mv, before = before, t = os.clock(), phase = 'arrive' }
end

function enqueue_pool(index, action)
    if pool_queued[index] then return end
    if action == 'lot' then my_lotted[index] = true end
    pool_queued[index] = true
    pool_q[#pool_q + 1] = { index = index, action = action }
end

function drain_pool()
    local n = 0
    while #pool_q > 0 and n < INSTANT_CAP do
        local item = table.remove(pool_q, 1)
        pool_queued[item.index] = nil
        if item.action == 'lot' then
            pcall(windower.ffxi.lot_item, item.index)
        else
            pcall(windower.ffxi.pass_item, item.index)
        end
        n = n + 1
    end
end

local function fire_drop(inv, d)
    drop_queued[d.slot] = nil
    local it = inv and inv[d.slot]
    if type(it) == 'table' and it.id == d.id and (it.count or 0) > 0 then
        if packets_ok then
            packets.inject(packets.new('outgoing', 0x028, { ['Count'] = it.count, ['Bag'] = 0, ['Inventory Index'] = d.slot }))
        else
            windower.ffxi.drop_item(d.slot, it.count)
        end
        drop_done = drop_done + 1
        drop_report[d.id] = (drop_report[d.id] or 0) + 1
        return true
    end
    return false
end

function drain_drops(now)
    if #drop_q == 0 then return end
    if drop_delay <= 0 then
        local inv = windower.ffxi.get_items(0)
        local n = 0
        while #drop_q > 0 and n < INSTANT_CAP do
            fire_drop(inv, table.remove(drop_q, 1))
            n = n + 1
        end
        drop_t = now
    elseif (now - drop_t) >= drop_delay then
        drop_t = now
        local inv = windower.ffxi.get_items(0)
        fire_drop(inv, table.remove(drop_q, 1))
    end
    if #drop_q == 0 and drop_done > 0 then
        local parts = {}
        for id, cnt in pairs(drop_report) do
            local nm = (res.items[id] and res.items[id].en) or ('item ' .. id)
            parts[#parts + 1] = nm .. (cnt > 1 and (' x' .. cnt) or '')
        end
        local list = #parts > 0 and (': ' .. table.concat(parts, ', ')) or ''
        alex_chat(123, '[Alexandria] dropped ' .. drop_done .. ' item' .. (drop_done == 1 and '' or 's') .. list, 'action')
        drop_done = 0
        drop_report = {}
        if not inv_dirty then inv_first_dirty = now end
        inv_dirty = true
        inv_dirty_at = now
    end
end

function scan_drops(names)
    names = names or drop_names
    if not next(names) then return end
    local inv = windower.ffxi.get_items(0)
    if not inv then return end
    local selling = ((shop_session and shop_autosell) or (sell_anywhere and in_town())) and next(shop_sell_list) ~= nil
    for slot = 1, (inv.max or 80) do
        local it = inv[slot]
        if type(it) == 'table' and it.id and it.id > 0 then
            local r = res.items[it.id]
            if r and r.en and names[r.en:lower()] then
                if not (selling and shop_sell_list[it.id] and not shop_no_sale(it.id)) then
                    enqueue_drop(slot, it.id)
                end
            end
        end
    end
end

clean_set = nil
clean_until = 0
function do_drop_clean(names)
    local set = {}
    local expanded = {}
    for _, nm in ipairs(names or {}) do
        local low = tostring(nm):lower()
        local grp = TREASURE_GROUPS[low]
        if grp then
            for _, id in ipairs(grp) do
                local r = res.items[id]
                if r and r.en then set[r.en:lower()] = true; expanded[#expanded + 1] = r.en end
            end
        else
            set[low] = true
            expanded[#expanded + 1] = tostring(nm)
        end
    end
    if not next(set) then return end
    clean_set = set
    clean_until = os.clock() + 12
    do_retrieve(expanded)
    scan_drops(set)
end

-- Temporary (3) is included: its items are used in place with /item and can't be
-- moved into inventory, so the use tick fires /item directly when the item is there.
USE_BAGS = { 0, 3, 5, 6, 7 }
USE_CARRY_BAGS = { 5, 6, 7 }

function emit_use(active)
    queue_send(('{"t":"use","active":%s,"id":%d,"name":"%s","done":%d,"total":%d}\n'):format(active and 'true' or 'false', use_id or 0, esc(use_name or ''), use_done or 0, use_total or 0))
end

function use_pull_stack(id)
    local di = windower.ffxi.get_bag_info(0)
    if not di or (di.max - di.count) <= 0 then return false end
    for _, bid in ipairs(USE_CARRY_BAGS) do
        local bag = windower.ffxi.get_items(bid)
        if type(bag) == 'table' then
            for s = 1, (bag.max or 80) do
                local it = bag[s]
                if type(it) == 'table' and it.id == id and it.id ~= 0 and it.status == 0 then
                    windower.ffxi.move_item(bid, 0, s, it.count or 1)
                    return true
                end
            end
        end
    end
    return false
end

function start_use(id, all, count)
    local r = res.items[id]
    if not r or not (r.targets and r.targets.Self) then
        alex_chat(207, '[Alexandria] that item cannot be used', 'error')
        return
    end
    local total = 0
    for _, bid in ipairs(USE_BAGS) do
        local bag = windower.ffxi.get_items(bid)
        if type(bag) == 'table' then
            for s = 1, (bag.max or 80) do
                local it = bag[s]
                if type(it) == 'table' and it.id == id and (it.status or 0) == 0 then total = total + (it.count or 0) end
            end
        end
    end
    if total <= 0 then
        alex_chat(207, '[Alexandria] none of that item in inventory', 'error')
        return
    end
    use_id = id
    use_name = r.en
    if count and count > 0 then use_total = math.min(count, total)
    elseif all then use_total = total
    else use_total = 1 end
    use_done = 0
    use_left = use_total
    use_delay = (r.cast_time or 0) + 2
    use_next = os.clock()
    use_move_at = 0
    emit_use(true)
end

function start_use_request(id, all, from_bag, slot, count)
    local r = res.items[id]
    if not r or not (r.targets and r.targets.Self) then
        alex_chat(207, '[Alexandria] that item cannot be used', 'error')
        return
    end
    -- A specific count uses the same all-style loop (which pulls stacks from the
    -- carry bags as needed) but capped, so from_bag/slot don't apply.
    if count and count > 1 then start_use(id, false, count) return end
    if all then start_use(id, true) return end
    -- Temporary bag (3) items are used in place -- never try to move them into inventory.
    if not from_bag or from_bag == 0 or from_bag == 3 then start_use(id, false) return end
    local di = windower.ffxi.get_bag_info(0)
    if di and (di.max - di.count) <= 0 then alex_chat(207, '[Alexandria] inventory full; cannot move that item to use', 'error') return end
    local items = windower.ffxi.get_items(from_bag)
    local it = slot and type(items) == 'table' and items[slot]
    if not (type(it) == 'table' and it.id == id and it.id ~= 0) then
        if slot then alex_chat(207, '[Alexandria] item no longer in that slot; use skipped', 'error') return end
        local m = find_in_bag(from_bag, id, nil)
        if not m then alex_chat(207, '[Alexandria] item not found in that bag', 'error') return end
        slot = m.slot
        it = type(items) == 'table' and items[slot]
    end
    local before = shop_count_inv(id)
    windower.ffxi.move_item(from_bag, 0, slot, 1)
    use_pending = { id = id, all = false, qty = 1, before = before, t = os.clock() }
end

function apply_droprules(names, autodrop, delay)
    auto_drop = autodrop and true or false
    if type(delay) == 'number' and delay >= 0 then drop_delay = delay end
    local idx = build_name_index()
    drop_names = {}
    local map_parts = {}
    for _, nm in ipairs(names or {}) do
        local low = tostring(nm):lower()
        local grp = TREASURE_GROUPS[low]
        if grp then
            for _, id in ipairs(grp) do
                local r = res.items[id]
                if r and r.en then
                    drop_names[r.en:lower()] = true
                    queue_icon(id)
                    map_parts[#map_parts + 1] = '"' .. esc(r.en) .. '":' .. id
                end
            end
        else
            drop_names[low] = true
            local id = idx[low]
            if id then
                queue_icon(id)
                map_parts[#map_parts + 1] = '"' .. esc(tostring(nm)) .. '":' .. id
            end
        end
    end
    queue_send('{"t":"dropmap","map":{' .. table.concat(map_parts, ',') .. '}}\n')
    if auto_drop then scan_drops() end
end

function do_retrieve(names)
    local idx = build_name_index()
    local want = {}
    for _, nm in ipairs(names or {}) do
        local id = idx[tostring(nm):lower()]
        if id then want[id] = true end
    end
    if not next(want) then return end
    local moved = 0
    for _, bid in ipairs({ 1, 9, 2, 4, 5, 6, 7 }) do
        local items = windower.ffxi.get_items(bid)
        if type(items) == 'table' and items.enabled then
            for s = 1, (items.max or 80) do
                local it = items[s]
                if type(it) == 'table' and it.id and it.id > 0 and want[it.id] then
                    local from, slot, cnt = bid, s, (it.count or 1)
                    enqueue_fast(function() windower.ffxi.move_item(from, 0, slot, cnt) end)
                    moved = moved + 1
                end
            end
        end
    end
    alex_chat(207, '[Alexandria] retrieving ' .. moved .. ' stack(s) to inventory', 'action')
end

local CURRENCY_FIELDS = {
    { 0x113, 'Conquest Points (San d\'Oria)', 'Conquest (San d\'Oria)' },
    { 0x113, 'Conquest Points (Bastok)', 'Conquest (Bastok)' },
    { 0x113, 'Conquest Points (Windurst)', 'Conquest (Windurst)' },
    { 0x118, 'Gallimaufry', 'Gallimaufry' },
    { 0x118, 'Mweya Plasm Corpuscles', 'Mweya Plasm Corpuscles' },
    { 0x118, 'Coalition Imprimaturs', 'Coalition Imprimaturs' },
    { 0x113, 'Sparks of Eminence', 'Sparks of Eminence' },
    { 0x113, 'Shining Stars', 'Accolades' },
    { 0x118, 'Bayld', 'Bayld' },
    { 0x118, 'Kinetic Units', 'Kinetic Units' },
    { 0x118, 'Escha Beads', 'Escha Beads' },
    { 0x118, 'Escha Silt', 'Escha Silt' },
    { 0x118, 'Potpourri', 'Potpourri' },
    { 0x118, 'Hallmarks', 'Hallmarks' },
    { 0x118, 'Badges of Gallantry', 'Badges of Gallantry' },
    { 0x118, 'Mog Segments', 'Mog Segments' },
    { 0x118, 'Domain Points', 'Domain Points' },
    { 0x118, 'Obsidian Fragments', 'Obsidian Fragments' },
    { 0x113, 'Cruor', 'Cruor' },
    { 0x113, 'Therion Ichor', 'Therion Ichor' },
    { 0x113, 'Traverser Stones', 'Traverser Stones' },
    { 0x113, 'Voidstones', 'Voidstones' },
    { 0x113, 'Allied Notes', 'Allied Notes' },
    { 0x113, 'A.M.A.N. Vouchers Stored', 'A.M.A.N. Vouchers' },
    { 0x113, 'Beastman Seals', 'Beastman Seals' },
    { 0x113, 'Kindred Seals', 'Kindred Seals' },
    { 0x113, 'Kindred Crests', 'Kindred Crests' },
    { 0x113, 'High Kindred Crests', 'High Kindred Crests' },
    { 0x113, 'Sacred Kindred Crests', 'Sacred Kindred Crests' },
    { 0x113, 'Cinders', 'Cinders' },
    { 0x113, 'Ballista Points', 'Ballista Points' },
    { 0x113, 'Imperial Standing', 'Imperial Standing' },
    { 0x113, 'Unity Accolades', 'Unity Accolades' },
    { 0x113, 'Op Credits', 'Op Credits' },
    { 0x113, 'Research Marks', 'Research Marks' },
    { 0x113, 'Login Points', 'Login Points' },
    { 0x113, 'Valor Points', 'Valor Points' },
    { 0x113, 'Ancient Beastcoins', 'Ancient Beastcoins' },
    { 0x113, 'Zeni', 'Zeni' },
    { 0x113, 'Nyzul Tokens', 'Nyzul Tokens' },
    { 0x113, 'Dominion Notes', 'Dominion Notes' },
    { 0x113, 'Deeds', 'Deeds' },
    { 0x113, 'Reclamation Marks', 'Reclamation Marks' },
    { 0x113, 'Resistance Credits', 'Resistance Credits' },
    { 0x118, 'Silver A.M.A.N. Vouchers Stored', 'Silver A.M.A.N. Vouchers' },
    { 0x118, 'Imperial Standing Accolades', 'Imperial Standing Accolades' },
    { 0x118, 'Temenos Units', 'Temenos Units' },
    { 0x118, 'Apollyon Units', 'Apollyon Units' },
    { 0x113, 'Scylds', 'Scylds' },
    { 0x113, 'Jettons', 'Jettons' },
    { 0x113, 'Moblin Marbles', 'Moblin Marbles' },
    { 0x113, 'Legion Points', 'Legion Points' },
    { 0x113, 'Fellow Points', 'Fellow Points' },
    { 0x113, 'Kupofried\'s Corundums', 'Kupofried\'s Corundums' },
    { 0x113, 'Infamy', 'Infamy' },
    { 0x113, 'Prestige', 'Prestige' },
    { 0x113, 'Assault Points (Leujaoam Sanctum)', 'Assault (Leujaoam Sanctum)' },
    { 0x113, 'Assault Points (M.J.T.G.)', 'Assault (Mamool Ja)' },
    { 0x113, 'Assault Points (Lebros Cavern)', 'Assault (Lebros Cavern)' },
    { 0x113, 'Assault Points (Periqia)', 'Assault (Periqia)' },
    { 0x113, 'Assault Points (Ilrusi Atoll)', 'Assault (Ilrusi Atoll)' },
    { 0x113, 'Chocobucks (San d\'Oria)', 'Chocobucks (San d\'Oria)' },
    { 0x113, 'Chocobucks (Bastok)', 'Chocobucks (Bastok)' },
    { 0x113, 'Chocobucks (Windurst)', 'Chocobucks (Windurst)' },
    { 0x118, 'Mystical Canteens', 'Mystical Canteens' },
    { 0x113, 'Guild Points (Fishing)', 'Guild (Fishing)' },
    { 0x113, 'Guild Points (Woodworking)', 'Guild (Woodworking)' },
    { 0x113, 'Guild Points (Smithing)', 'Guild (Smithing)' },
    { 0x113, 'Guild Points (Goldsmithing)', 'Guild (Goldsmithing)' },
    { 0x113, 'Guild Points (Weaving)', 'Guild (Weaving)' },
    { 0x113, 'Guild Points (Leathercraft)', 'Guild (Leathercraft)' },
    { 0x113, 'Guild Points (Bonecraft)', 'Guild (Bonecraft)' },
    { 0x113, 'Guild Points (Alchemy)', 'Guild (Alchemy)' },
    { 0x113, 'Guild Points (Cooking)', 'Guild (Cooking)' },
    { 0x113, 'Daily Tally', 'Daily Tally' },
    { 0x113, 'Cave Conservation Points', 'Cave Conservation Points' },
    { 0x113, 'Imperial Army ID Tags', 'Imperial Army ID Tags' },
    { 0x113, 'Moblin Pheromone Sacks', 'Moblin Pheromone Sacks' },
    { 0x113, '1st Echelon Battle Trophies', '1st Echelon Battle Trophies' },
    { 0x113, '2nd Echelon Battle Trophies', '2nd Echelon Battle Trophies' },
    { 0x113, '3rd Echelon Battle Trophies', '3rd Echelon Battle Trophies' },
    { 0x113, '4th Echelon Battle Trophies', '4th Echelon Battle Trophies' },
    { 0x113, '5th Echelon Battle Trophies', '5th Echelon Battle Trophies' },
    { 0x113, 'Wizened Tunnel Worms', 'Wizened Tunnel Worms' },
    { 0x113, 'Wizened Morion Worms', 'Wizened Morion Worms' },
    { 0x113, 'Wizened Phantom Worms', 'Wizened Phantom Worms' },
    { 0x113, 'Synergy Fewell (Fire)', 'Synergy Fewell (Fire)' },
    { 0x113, 'Synergy Fewell (Ice)', 'Synergy Fewell (Ice)' },
    { 0x113, 'Synergy Fewell (Wind)', 'Synergy Fewell (Wind)' },
    { 0x113, 'Synergy Fewell (Earth)', 'Synergy Fewell (Earth)' },
    { 0x113, 'Synergy Fewell (Lightning)', 'Synergy Fewell (Lightning)' },
    { 0x113, 'Synergy Fewell (Water)', 'Synergy Fewell (Water)' },
    { 0x113, 'Synergy Fewell (Light)', 'Synergy Fewell (Light)' },
    { 0x113, 'Synergy Fewell (Dark)', 'Synergy Fewell (Dark)' },
    { 0x113, 'Fire Crystals', 'Fire Crystals' },
    { 0x113, 'Ice Crystals', 'Ice Crystals' },
    { 0x113, 'Wind Crystals', 'Wind Crystals' },
    { 0x113, 'Earth Crystals', 'Earth Crystals' },
    { 0x113, 'Lightning Crystals', 'Lightning Crystals' },
    { 0x113, 'Water Crystals', 'Water Crystals' },
    { 0x113, 'Light Crystals', 'Light Crystals' },
    { 0x113, 'Dark Crystals', 'Dark Crystals' },
    { 0x113, 'Rems Tale Chapter 1', 'Rems Tale Chapter 1' },
    { 0x113, 'Rems Tale Chapter 2', 'Rems Tale Chapter 2' },
    { 0x113, 'Rems Tale Chapter 3', 'Rems Tale Chapter 3' },
    { 0x113, 'Rems Tale Chapter 4', 'Rems Tale Chapter 4' },
    { 0x113, 'Rems Tale Chapter 5', 'Rems Tale Chapter 5' },
    { 0x113, 'Rems Tale Chapter 6', 'Rems Tale Chapter 6' },
    { 0x113, 'Rems Tale Chapter 7', 'Rems Tale Chapter 7' },
    { 0x113, 'Rems Tale Chapter 8', 'Rems Tale Chapter 8' },
    { 0x113, 'Rems Tale Chapter 9', 'Rems Tale Chapter 9' },
    { 0x113, 'Rems Tale Chapter 10', 'Rems Tale Chapter 10' },
    { 0x118, 'Domain Points Earned Today', 'Domain Points Earned Today' },
    { 0x118, 'Total Hallmarks', 'Total Hallmarks' },
    { 0x118, 'Crafter Points', 'Crafter Points' },
    { 0x118, 'Lebondopt Wings Stored', 'Lebondopt Wings' },
    { 0x118, 'Pulchridopt Wings Stored', 'Pulchridopt Wings' },
    { 0x118, 'Mellidopt Wings Stored', 'Mellidopt Wings' },
    { 0x118, 'Fire Crystals Set', 'Fire Crystals (Set)' },
    { 0x118, 'Ice Crystals Set', 'Ice Crystals (Set)' },
    { 0x118, 'Wind Crystals Set', 'Wind Crystals (Set)' },
    { 0x118, 'Earth Crystals Set', 'Earth Crystals (Set)' },
    { 0x118, 'Lightning Crystals Set', 'Lightning Crystals (Set)' },
    { 0x118, 'Water Crystals Set', 'Water Crystals (Set)' },
    { 0x118, 'Light Crystals Set', 'Light Crystals (Set)' },
    { 0x118, 'Dark Crystals Set', 'Dark Crystals (Set)' },
    { 0x118, 'MC-S-SR01s Set', 'MC-S-SR01s' },
    { 0x118, 'MC-S-SR02s Set', 'MC-S-SR02s' },
    { 0x118, 'MC-S-SR03s Set', 'MC-S-SR03s' },
    { 0x118, 'Liquefaction Spheres Set', 'Liquefaction Spheres' },
    { 0x118, 'Induration Spheres Set', 'Induration Spheres' },
    { 0x118, 'Detonation Spheres Set', 'Detonation Spheres' },
    { 0x118, 'Scission Spheres Set', 'Scission Spheres' },
    { 0x118, 'Impaction Spheres Set', 'Impaction Spheres' },
    { 0x118, 'Reverberation Spheres Set', 'Reverberation Spheres' },
    { 0x118, 'Transfixion Spheres Set', 'Transfixion Spheres' },
    { 0x118, 'Compression Spheres Set', 'Compression Spheres' },
    { 0x118, 'Fusion Spheres Set', 'Fusion Spheres' },
    { 0x118, 'Distortion Spheres Set', 'Distortion Spheres' },
    { 0x118, 'Fragmentation Spheres Set', 'Fragmentation Spheres' },
    { 0x118, 'Gravitation Spheres Set', 'Gravitation Spheres' },
    { 0x118, 'Light Spheres Set', 'Light Spheres' },
    { 0x118, 'Darkness Spheres Set', 'Darkness Spheres' },
    { 0x118, 'Ghastly Stones Stored', 'Ghastly Stones' },
    { 0x118, 'Ghastly Stones +1 Stored', 'Ghastly Stones +1' },
    { 0x118, 'Ghastly Stones +2 Stored', 'Ghastly Stones +2' },
    { 0x118, 'Verdigris Stones Stored', 'Verdigris Stones' },
    { 0x118, 'Verdigris Stones +1 Stored', 'Verdigris Stones +1' },
    { 0x118, 'Verdigris Stones +2 Stored', 'Verdigris Stones +2' },
    { 0x118, 'Wailing Stones Stored', 'Wailing Stones' },
    { 0x118, 'Wailing Stones +1 Stored', 'Wailing Stones +1' },
    { 0x118, 'Wailing Stones +2 Stored', 'Wailing Stones +2' },
    { 0x118, 'Snowslit Stones Stored', 'Snowslit Stones' },
    { 0x118, 'Snowslit Stones +1 Stored', 'Snowslit Stones +1' },
    { 0x118, 'Snowslit Stones +2 Stored', 'Snowslit Stones +2' },
    { 0x118, 'Snowtip Stones Stored', 'Snowtip Stones' },
    { 0x118, 'Snowtip Stones +1 Stored', 'Snowtip Stones +1' },
    { 0x118, 'Snowtip Stones +2 Stored', 'Snowtip Stones +2' },
    { 0x118, 'Snowdim Stones Stored', 'Snowdim Stones' },
    { 0x118, 'Snowdim Stones +1 Stored', 'Snowdim Stones +1' },
    { 0x118, 'Snowdim Stones +2 Stored', 'Snowdim Stones +2' },
    { 0x118, 'Snoworb Stones Stored', 'Snoworb Stones' },
    { 0x118, 'Snoworb Stones +1 Stored', 'Snoworb Stones +1' },
    { 0x118, 'Snoworb Stones +2 Stored', 'Snoworb Stones +2' },
    { 0x118, 'Leafslit Stones Stored', 'Leafslit Stones' },
    { 0x118, 'Leafslit Stones +1 Stored', 'Leafslit Stones +1' },
    { 0x118, 'Leafslit Stones +2 Stored', 'Leafslit Stones +2' },
    { 0x118, 'Leaftip Stones Stored', 'Leaftip Stones' },
    { 0x118, 'Leaftip Stones +1 Stored', 'Leaftip Stones +1' },
    { 0x118, 'Leaftip Stones +2 Stored', 'Leaftip Stones +2' },
    { 0x118, 'Leafdim Stones Stored', 'Leafdim Stones' },
    { 0x118, 'Leafdim Stones +1 Stored', 'Leafdim Stones +1' },
    { 0x118, 'Leafdim Stones +2 Stored', 'Leafdim Stones +2' },
    { 0x118, 'Leaforb Stones Stored', 'Leaforb Stones' },
    { 0x118, 'Leaforb Stones +1 Stored', 'Leaforb Stones +1' },
    { 0x118, 'Leaforb Stones +2 Stored', 'Leaforb Stones +2' },
    { 0x118, 'Duskslit Stones Stored', 'Duskslit Stones' },
    { 0x118, 'Duskslit Stones +1 Stored', 'Duskslit Stones +1' },
    { 0x118, 'Duskslit Stones +2 Stored', 'Duskslit Stones +2' },
    { 0x118, 'Dusktip Stones Stored', 'Dusktip Stones' },
    { 0x118, 'Dusktip Stones +1 Stored', 'Dusktip Stones +1' },
    { 0x118, 'Dusktip Stones +2 Stored', 'Dusktip Stones +2' },
    { 0x118, 'Duskdim Stones Stored', 'Duskdim Stones' },
    { 0x118, 'Duskdim Stones +1 Stored', 'Duskdim Stones +1' },
    { 0x118, 'Duskdim Stones +2 Stored', 'Duskdim Stones +2' },
    { 0x118, 'Duskorb Stones Stored', 'Duskorb Stones' },
    { 0x118, 'Duskorb Stones +1 Stored', 'Duskorb Stones +1' },
    { 0x118, 'Duskorb Stones +2 Stored', 'Duskorb Stones +2' },
    { 0x118, 'Pellucid Stones Stored', 'Pellucid Stones' },
    { 0x118, 'Fern Stones Stored', 'Fern Stones' },
    { 0x118, 'Taupe Stones Stored', 'Taupe Stones' },
}

function build_currency()
    local gil = 0
    local ok, items = pcall(windower.ffxi.get_items)
    if ok and items and items.gil then gil = items.gil end
    -- Only report a currency page that belongs to the CURRENT character. A page whose owner id
    -- doesn't match is left over from a previous character on a shared client (e.g. a no-progress
    -- mule that never receives its own 0x118), and must not be broadcast as this character's.
    local pid = (windower.ffxi.get_player() or {}).id
    local parts = {}
    for _, e in ipairs(CURRENCY_FIELDS) do
        local pkt, owner = currency_cur2, currency_cur2_id
        if e[1] == 0x113 then pkt, owner = currency_cur1, currency_cur1_id end
        local v = (pkt and owner and owner == pid) and pkt[e[2]]
        if type(v) == 'number' then
            parts[#parts + 1] = '{"n":"' .. esc(e[3]) .. '","v":' .. v .. '}'
        end
    end
    return '{"t":"currency","gil":' .. gil .. ',"list":[' .. table.concat(parts, ',') .. ']}\n'
end

function currency_request()
    if not packets_ok then return end
    local now = os.clock()
    if now - currency_req_t < 2 then return end
    currency_req_t = now
    pcall(function() packets.inject(packets.new('outgoing', 0x10F)) end)
    coroutine.schedule(function() if packets_ok then pcall(function() packets.inject(packets.new('outgoing', 0x115)) end) end end, 1)
end

function ah_at_ah(zone)
    local z = zone
    if z == nil then
        local info = windower.ffxi.get_info()
        z = info and info.zone
    end
    local name = z and res.zones[z] and res.zones[z].en
    return name ~= nil and AH_ZONES[name] == true
end

function ah_usable()
    if ah_at_ah() then return true end
    local info = windower.ffxi.get_info()
    if info and info.mog_house and ah_at_ah(last_open_zone) then return true end
    return false
end

function dbox_allowed()
    if ah_at_ah() then return true end
    local info = windower.ffxi.get_info()
    if info and info.mog_house then return true end
    local z = info and info.zone
    return z ~= nil and NOMAD_ZONES[z] == true
end

function ah_find_empty()
    if ah_box then
        for s = 0, 6 do
            if ah_box[s] and ah_box[s].status == 'Empty' then return s end
        end
    end
    return nil
end

local function le4(v) v = math.floor(v); return string.char(v % 256, math.floor(v / 256) % 256, math.floor(v / 65536) % 256, math.floor(v / 16777216) % 256) end
local function le2(v) v = math.floor(v); return string.char(v % 256, math.floor(v / 256) % 256) end

function ah_request_status()
    if not packets_ok then return false end
    local work = string.char(0x4E, 0x1E, 0, 0, 0x0A, 0xFF, 0, 0) .. string.rep('\0', 52)
    pcall(windower.packets.inject_outgoing, 0x4E, work)
    coroutine.schedule(function()
        if packets_ok then
            local info = string.char(0x4E, 0x1E, 0, 0, 0x05, 0, 0, 0) .. string.rep('\0', 52)
            pcall(windower.packets.inject_outgoing, 0x4E, info)
        end
    end, 0.5)
    return true
end

-- Pop the in-game auction house window by injecting the server's menu-open response
-- (incoming 0x4C, option 0x02), the same client-side trick used to open the delivery box.
function ah_open_menu()
    if not packets_ok then return false end
    local p = string.char(0x4C, 0x1E, 0, 0, 0x02, 0, 0x01) .. string.rep('\0', 53)
    pcall(windower.packets.inject_incoming, 0x4C, p)
    return true
end

local DBOX_OP_DELAY = 1.0

local function dbox_op(cmd, box_no, post_no, item_no)
    return string.char(0x4D, 0x10, 0, 0, cmd, box_no, post_no, item_no, 0xFF, 0xFF, 0xFF, 0xFF, 0, 0, 0, 0) .. string.rep('\0', 16)
end

dbox_pq = {}
dbox_pq_last = 0
DBOX_PKT_GAP = 0.5

local function dbox_inject(p)
    dbox_pq[#dbox_pq + 1] = p
end

function dbox_pq_drain(now)
    if #dbox_pq == 0 then return end
    -- Same guard as the AH queue: never fire delivery-box packets once we can no longer reach a Moogle
    -- (walked away / zoned after queuing). Drop the queue instead of poking the server off-site.
    if not dbox_allowed() then dbox_pq = {}; return end
    if now - dbox_pq_last < DBOX_PKT_GAP then return end
    local p = table.remove(dbox_pq, 1)
    if packets_ok then pcall(windower.packets.inject_outgoing, 0x4D, p) end
    dbox_pq_last = now
end

local function dbox_utime(ts)
    -- RequestTime from the 0x4B delivery box packet is already a Unix timestamp (seconds
    -- since 1970); pass it straight through. The old formula divided by 60, which crushed
    -- the spread so every item read as the same date.
    if not ts or ts == 0 then return 0 end
    return math.floor(ts)
end

local DBOX_DLG_IN = string.char(0x4B, 0x0A, 0, 0, 0x0E, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF)
local DBOX_DLG_OUT = string.char(0x4B, 0x0A, 0, 0, 0x0D, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF)
local DBOX_DLG_CLOSE = string.char(0x4B, 0x0A, 0, 0, 0x0F, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x01, 0xFF, 0xFF, 0xFF, 0, 0, 0, 0)

local function dbox_close()
    if packets_ok then pcall(windower.packets.inject_incoming, 0x4B, DBOX_DLG_CLOSE) end
end

-- Open a box purely client-side, exactly like the //dbox / //obox commands: inject the
-- box dialog and let the game client run its own handshake with the server. We send NO
-- outgoing packets here -- those needlessly re-open the box and trip the server's reopen
-- limit ("Please try again in a little while"). Contents arrive on their own and are
-- captured passively in dbox_handle_incoming. Outgoing packets are sent only for real
-- actions (take / mail / return).
function dbox_open_inject(which)
    if packets_ok then pcall(windower.packets.inject_incoming, 0x4B, which == 'out' and DBOX_DLG_OUT or DBOX_DLG_IN) end
    dbox.open = which
    dbox_open_pending = false
    dbox_open_phase = nil
    dbox_last_note = (which == 'out' and 'outbox' or 'inbox') .. ' open'
    dbox_dirty = true
    dbox_status_dirty = true
end

function dbox_open(which)
    if not packets_ok or not dbox_allowed() then return false end
    dbox_open_inject(which)
    dbox_autoref_arm(which)
    return true
end

function dbox_open_box(which, cd)
    if not packets_ok or not dbox_allowed() then return false end
    if dbox.open == which and not dbox_open_pending then dbox_status_dirty = true return false end
    if dbox.open ~= nil then
        -- A box is already open: cleanly swap. Close it client-side, then open the other
        -- after a short beat so the client tears one down before showing the next.
        dbox_close(); dbox.open = nil
        dbox_open_pending = true
        dbox_open_which = which
        dbox_open_phase = 'swap'
        dbox_open_t = os.clock()
        dbox_last_note = 'opening ' .. (which == 'out' and 'outbox' or 'inbox')
        dbox_status_dirty = true
    else
        dbox_open_inject(which)
    end
    dbox_autoref_arm(which)
    return true
end

function dbox_open_tick(now)
    if not dbox_open_pending then return end
    if dbox_open_phase == 'swap' and now - dbox_open_t >= DBOX_SWITCH_DELAY then
        dbox_open_inject(dbox_open_which)
    end
end

-- Deliveries can keep landing for a few seconds after the box first opens, and FFXI only
-- sends the box list on open. After opening, reopen the box (client-side) until its
-- contents stop changing, then stop: a settled box reopens at most once, a box with items
-- still arriving keeps refreshing until quiet, and it never reopens mid-action (that would
-- pull the box out from under a take/mail). This keeps the in-game window from flashing
-- endlessly while still flushing late arrivals into the UI.
DBOX_AUTOREF_GAP = 2.5
DBOX_AUTOREF_MAX = 6

function dbox_box_sig(which)
    local box = (which == 'out') and dbox.outbox or dbox.inbox
    local p = {}
    for s = 0, 7 do local it = box[s]; p[s + 1] = it and (it.id .. 'x' .. (it.count or 1)) or '-' end
    return table.concat(p, ',')
end

function dbox_autoref_arm(which)
    dbox_autoref = { which = which, due = os.clock() + DBOX_AUTOREF_GAP, prev = dbox_box_sig(which), first = true, tries = 0 }
end

function dbox_autoref_tick(now)
    local a = dbox_autoref
    if not a then return end
    if dbox.open ~= a.which and not dbox_open_pending then dbox_autoref = nil; dbox_status_dirty = true; return end
    if dbox_run or #dbox_q > 0 then a.due = now + DBOX_AUTOREF_GAP; return end
    if dbox_open_pending then return end
    if now < a.due then return end
    local sig = dbox_box_sig(a.which)
    if (not a.first and sig == a.prev) or a.tries >= DBOX_AUTOREF_MAX then dbox_autoref = nil; dbox_status_dirty = true; return end
    a.first = false
    a.prev = sig
    dbox_close(); dbox.open = nil
    dbox_open_pending = true
    dbox_open_which = a.which
    dbox_open_phase = 'swap'
    dbox_open_t = now
    a.tries = a.tries + 1
    a.due = now + DBOX_SWITCH_DELAY + DBOX_AUTOREF_GAP
    dbox_status_dirty = true
end

function dbox_close_box()
    if not packets_ok then return false end
    dbox_close()
    dbox.open = nil
    dbox_last_note = 'closed delivery box'
    dbox_status_dirty = true
    return true
end

function dbox_request_status()
    if not packets_ok then return false end
    if not dbox.open then
        dbox_last_note = 'open your delivery box to load it'
        dbox_status_dirty = true
        return false
    end
    if dbox_open_pending then return false end
    -- FFXI sends the box list once per open, so items that land after the box was opened
    -- aren't seen until a fresh open. Refresh by closing and reopening the same box
    -- client-side -- exactly the manual close+reopen that picks up late deliveries. The
    -- displayed contents persist through the swap, so this never blanks the view.
    local which = dbox.open
    dbox_close(); dbox.open = nil
    dbox_open_pending = true
    dbox_open_which = which
    dbox_open_phase = 'swap'
    dbox_open_t = os.clock()
    dbox_status_dirty = true
    return true
end

function dbox_get_batch(box_no, slots)
    if not packets_ok or not dbox_allowed() then return false end
    if type(slots) ~= 'table' or #slots == 0 then return false end
    pcall(windower.packets.inject_incoming, 0x4B, box_no == 2 and DBOX_DLG_OUT or DBOX_DLG_IN)
    local t = 1.0
    for _, slot in ipairs(slots) do
        local s = tonumber(slot)
        if s and s >= 0 and s <= 7 then
            coroutine.schedule(function() dbox_inject(dbox_op(0x0A, box_no, s, 0xFF)) end, t)
            t = t + DBOX_OP_DELAY
        end
    end
    coroutine.schedule(function() dbox_close(); dbox_dirty = true end, t + 0.5)
    return true
end

function dbox_handle_incoming(data)
    if not packets_ok then return end
    local ok, p = pcall(packets.parse, 'incoming', data)
    if not ok or not p then return end
    if dbox_debug then
        dbox_log(('IN  type=%s slot=%s item=%s count=%s u11=%s flags=%s'):format(tostring(p.Type), tostring(p['Delivery Slot']), tostring(p.Item), tostring(p.Count), tostring(p['_unknown11']), tostring(p['Flags?'])))
        dbox_log('    ' .. dbox_hex(data))
    end
    local t = p.Type
    if t == 0x0E or t == 0x0D then
        if #data >= 13 and data:byte(13) == 0xFA then
            -- The box is already switched client-side by the dialog inject, so the
            -- server's reopen-limit busy is harmless. Don't bounce the open machine back
            -- to 'wait' (that loops the "Opening..." state forever) -- let it finish.
            dbox_last_note = 'delivery box busy'
            dbox_status_dirty = true
            return
        end
        dbox.open = (t == 0x0E) and 'in' or 'out'
        dbox_status_dirty = true
        return
    elseif t == 0x0F then dbox.open = nil; dbox_status_dirty = true; return
    elseif t == 0x05 then dbox_check_ack = true; return end
    local slot = p['Delivery Slot']
    if slot == nil or slot < 0 or slot > 7 then return end
    if t ~= 0x01 then return end
    local target = (dbox.open == 'out') and dbox.outbox or dbox.inbox
    local item = p.Item
    if item == 0xFFFF then
        local hi = tonumber(p['_unknown11']) or 0
        target[slot] = { id = 65535, count = (p.Count or 0) + hi * 65536, name = 'Gil', who = p['Player Name'] or '', ts = dbox_utime(p.Timestamp), gil = true }
    elseif item and item ~= 0 then
        local r = res.items[item]
        target[slot] = { id = item, count = p.Count or 1, name = (r and r.en) or ('Item ' .. item), who = p['Player Name'] or '', ts = dbox_utime(p.Timestamp) }
        queue_icon(item)
    else
        target[slot] = nil
    end
    dbox_dirty = true
end

function build_dbox()
    local function box_json(box)
        local parts = {}
        for s = 0, 7 do
            local it = box[s]
            if it then
                parts[#parts + 1] = '{"s":' .. s .. ',"id":' .. it.id .. ',"c":' .. (it.count or 1) ..
                    ',"n":"' .. esc(it.name or '') .. '","who":"' .. esc(it.who or '') .. '","ts":' .. (it.ts or 0) .. (it.gil and ',"gil":true' or '') .. '}'
            end
        end
        return '[' .. table.concat(parts, ',') .. ']'
    end
    return '{"t":"dbox","in":' .. box_json(dbox.inbox) .. ',"out":' .. box_json(dbox.outbox) .. '}\n'
end

DBOX_OPEN_IN = 0x0D
DBOX_OPEN_OUT = 0x0E
dbox_q = {}
dbox_run = nil
dbox_status_dirty = false
dbox_last_note = ''
dbox_debug = false
dbox_next_open = 0
dbox_check_ack = false
DBOX_REOPEN_COOLDOWN = 4.0
dbox_ready_at = 0
dbox_open_pending = false
dbox_open_which = 'in'
dbox_open_phase = nil
dbox_open_t = 0
dbox_autoref = nil
DBOX_OPEN_COOLDOWN = 0
DBOX_SWITCH_DELAY = 1.2

function dbox_hex(data)
    local t = {}
    for i = 1, #data do t[#t + 1] = ('%02X'):format(data:byte(i)) end
    return table.concat(t, ' ')
end

function dbox_log(line, reset)
    local f = io.open(windower.addon_path .. 'dboxdump.txt', reset and 'w' or 'a')
    if f then f:write(line .. '\n'); f:close() end
end

function trade_log(line, reset)
    local f = io.open(windower.addon_path .. 'tradedump.txt', reset and 'w' or 'a')
    if f then f:write(line .. '\n'); f:close() end
end

function dbox_open_session(which)
    if not packets_ok or not dbox_allowed() then return false end
    dbox_inject(dbox_op(which == 'out' and DBOX_OPEN_OUT or DBOX_OPEN_IN, 0xFF, 0xFF, 0xFF))
    return true
end

function dbox_pad_name(name)
    local nm = tostring(name or ''):gsub('[^%w]', '')
    if #nm == 0 then return nil end
    nm = nm:sub(1, 1):upper() .. nm:sub(2, 15)
    return nm .. string.rep('\0', 16 - #nm)
end

function dbox_set_packet(post_no, inv_idx, stacks, name)
    local nb = dbox_pad_name(name)
    if not nb then return nil end
    local s = math.max(1, stacks or 1)
    local stk = string.char(s % 256, math.floor(s / 256) % 256, math.floor(s / 65536) % 256, math.floor(s / 16777216) % 256)
    return string.char(0x4D, 0x10, 0, 0, 0x02, 2, post_no % 256, inv_idx % 256) .. stk .. string.char(0, 0, 0, 0) .. nb
end

function dbox_free_out_slot()
    for s = 0, 7 do if not dbox.outbox[s] then return s end end
    return nil
end

function dbox_enqueue(job)
    dbox_autoref = nil  -- the user is acting on the box; stop auto-reopening it
    dbox_q[#dbox_q + 1] = job
    dbox_status_dirty = true
end

function dbox_clear_queue()
    dbox_q = {}
    dbox_pq = {}
    dbox_run = nil
    dbox_open_pending = false
    dbox_open_phase = nil
    dbox_last_note = 'cancelled'
    dbox_status_dirty = true
end

function dbox_finish(note)
    dbox_run = nil
    dbox_last_note = note or ''
    dbox_status_dirty = true
end

function dbox_take(slots)
    if type(slots) ~= 'table' then return false end
    local list = {}
    for _, s in ipairs(slots) do local n = tonumber(s); if n and n >= 0 and n <= 7 then list[#list + 1] = n end end
    if #list == 0 then return false end
    dbox_enqueue({ kind = 'take', slots = list, i = 1, phase = 'get' })
    return true
end

function dbox_take_all()
    local slots = {}
    for s = 0, 7 do if dbox.inbox[s] then slots[#slots + 1] = s end end
    return dbox_take(slots)
end

function dbox_send(bag, slot, id, count, target)
    if not dbox_pad_name(target) then return false end
    if not tonumber(id) then return false end
    dbox_enqueue({ kind = 'send', bag = tonumber(bag) or 0, slot = slot and tonumber(slot) or nil, id = tonumber(id), count = math.max(1, tonumber(count) or 1), target = tostring(target), phase = 'prep' })
    return true
end

function dbox_send_gil(amount, target)
    if not dbox_pad_name(target) then return false end
    local have = (windower.ffxi.get_items() or {}).gil or 0
    local amt = math.min(1000000, have, math.max(1, math.floor(tonumber(amount) or 0)))
    if amt < 1 then dbox_last_note = 'no gil to send'; dbox_status_dirty = true; return false end
    dbox_enqueue({ kind = 'send', gil = true, invslot = 0, count = amt, target = tostring(target), phase = 'open' })
    return true
end

function dbox_return(slots)
    if type(slots) ~= 'table' then return false end
    local list = {}
    for _, s in ipairs(slots) do local n = tonumber(s); if n and n >= 0 and n <= 7 then list[#list + 1] = n end end
    if #list == 0 then return false end
    dbox_enqueue({ kind = 'return', slots = list, i = 1, phase = 'cancel' })
    return true
end

function dbox_tick(now)
    if not dbox_run then
        if #dbox_q == 0 then return end
        if not packets_ok or not dbox_allowed() then dbox_clear_queue(); dbox_last_note = 'not at delivery box'; dbox_status_dirty = true; return end
        dbox_run = table.remove(dbox_q, 1)
        dbox_run.t = now
        dbox_run.start = now
        dbox_status_dirty = true
        return
    end
    local r = dbox_run
    if dbox_open_pending then return end  -- a box open/reopen is mid-flight; wait so the action sees a settled box
    if now - r.start > 90 then dbox_finish('timed out') return end

    if r.kind == 'take' then
        if dbox.open ~= 'in' then dbox_finish('open your delivery inbox in-game, then Take') return end
        if r.phase == 'get' then
            if now - r.t < DBOX_OP_DELAY then return end
            if r.i > #r.slots then r.phase = 'fin'; r.t = now; return end
            dbox_inject(dbox_op(0x08, 1, r.slots[r.i], 0xFF)); r.t = now; r.phase = 'getone'
        elseif r.phase == 'getone' then
            if now - r.t < 0.6 then return end
            local s = r.slots[r.i]
            dbox_inject(dbox_op(0x0A, 1, s, 0xFF))
            dbox.inbox[s] = nil; dbox_dirty = true
            r.i = r.i + 1; r.t = now; r.phase = 'get'
        elseif r.phase == 'fin' then
            if now - r.t < 0.5 then return end
            dbox_finish('took ' .. #r.slots .. ' item(s)')
        end
        return
    end

    if r.kind == 'send' then
        if r.phase == 'prep' then
            if r.bag and r.bag ~= 0 then
                local items = windower.ffxi.get_items(r.bag)
                local it = r.slot and type(items) == 'table' and items[r.slot]
                if not (type(it) == 'table' and it.id == r.id and it.id ~= 0) then dbox_finish('item moved; send skipped') return end
                local di = windower.ffxi.get_bag_info(0)
                if di and (di.max - di.count) <= 0 then dbox_finish('inventory full') return end
                r.count = math.min(r.count, it.count or r.count)
                windower.ffxi.move_item(r.bag, 0, r.slot, r.count)
                r.t = now; r.phase = 'land'
            else
                local inv = windower.ffxi.get_items(0)
                local it = r.slot and type(inv) == 'table' and inv[r.slot]
                if not (type(it) == 'table' and it.id == r.id and it.id ~= 0) then dbox_finish('item moved; send skipped') return end
                r.invslot = r.slot
                r.count = math.min(r.count, it.count or r.count)
                r.phase = 'open'; r.t = now
            end
        elseif r.phase == 'land' then
            local m = find_in_bag(0, r.id, nil)
            if m then r.invslot = m.slot; r.phase = 'open'; r.t = now
            elseif now - r.t > 8 then dbox_finish('move timed out') end
        elseif r.phase == 'open' then
            if dbox.open ~= 'out' then dbox_finish('open your delivery outbox in-game, then Mail') return end
            r.t = now; r.phase = 'set'
        elseif r.phase == 'set' then
            if now - r.t < 0.6 then return end
            r.post = dbox_free_out_slot() or 0
            local p = dbox_set_packet(r.post, r.invslot, r.count, r.target)
            if not p then dbox_finish('bad recipient') return end
            dbox_inject(p); r.t = now; r.phase = 'send'
        elseif r.phase == 'send' then
            if now - r.t < 0.9 then return end
            dbox_inject(dbox_op(0x03, 2, r.post or 0, 0xFF)); r.t = now; r.phase = 'fin'
        elseif r.phase == 'fin' then
            if now - r.t < 1.5 then return end
            dbox_inject(dbox_op(0x01, 2, 0xFF, 0xFF))
            coroutine.schedule(function() if packets_ok then dbox_inject(dbox_op(0x05, 2, 0xFF, 0xFF)); dbox_dirty = true end end, 0.5)
            dbox_finish('mailed to ' .. (r.target or ''))
        end
        return
    end

    if r.kind == 'return' then
        if dbox.open ~= 'out' then dbox_finish('open your delivery outbox in-game, then Return') return end
        if r.phase == 'cancel' then
            if now - r.t < DBOX_OP_DELAY then return end
            if r.i > #r.slots then r.phase = 'fin'; r.t = now; return end
            dbox_inject(dbox_op(0x04, 2, r.slots[r.i], 0xFF)); r.t = now; r.phase = 'getone'
        elseif r.phase == 'getone' then
            if now - r.t < 0.6 then return end
            local s = r.slots[r.i]
            dbox_inject(dbox_op(0x0A, 2, s, 0xFF))
            dbox.outbox[s] = nil; dbox_dirty = true
            r.i = r.i + 1; r.t = now; r.phase = 'cancel'
        elseif r.phase == 'fin' then
            if now - r.t < 0.5 then return end
            dbox_finish('returned ' .. #r.slots .. ' item(s)')
        end
        return
    end

    dbox_finish('unknown job')
end

function build_dbox_status()
    local kind = dbox_run and dbox_run.kind or ''
    local phase = dbox_run and dbox_run.phase or ''
    local cd = math.max(0, math.ceil(dbox_ready_at - os.clock()))
    local loading = (dbox_open_pending or dbox_autoref) and true or false
    return '{"t":"dboxstatus","busy":' .. (dbox_run and 'true' or 'false') ..
        ',"queue":' .. #dbox_q .. ',"kind":"' .. kind .. '","phase":"' .. phase ..
        '","note":"' .. esc(dbox_last_note or '') .. '","cooldown":' .. cd .. ',"opening":' .. (dbox_open_pending and 'true' or 'false') ..
        ',"loading":' .. (loading and 'true' or 'false') ..
        ',"open":"' .. (dbox.open or '') .. '"}\n'
end

local function rd_u16(data, i) return data:byte(i) + data:byte(i + 1) * 256 end
local function rd_u32(data, i) return data:byte(i) + data:byte(i + 1) * 256 + data:byte(i + 2) * 65536 + data:byte(i + 3) * 16777216 end

local function trade_expand(items)
    local inv = windower.ffxi.get_items(0)
    local entries = {}
    if not inv then return entries end
    for _, req in ipairs(items) do
        if #entries >= 8 then break end
        local id = tonumber(req.id)
        local need = math.max(1, tonumber(req.count) or 1)
        local fixed = tonumber(req.slot)
        if fixed then
            local it = inv[fixed]
            if type(it) == 'table' and it.id == id and it.status == 0 and (it.count or 0) > 0 then
                entries[#entries + 1] = { slot = fixed, id = id, count = math.min(need, it.count) }
            end
        elseif id then
            for s = 1, (inv.max or 80) do
                if #entries >= 8 or need <= 0 then break end
                local it = inv[s]
                if type(it) == 'table' and it.id == id and it.status == 0 and (it.count or 0) > 0 then
                    local take = math.min(need, it.count)
                    entries[#entries + 1] = { slot = s, id = id, count = take }
                    need = need - take
                end
            end
        end
    end
    return entries
end

local function trade_offer(id, index) pcall(windower.packets.inject_outgoing, 0x32, string.char(0x32, 0x06, 0, 0) .. le4(id) .. le2(index) .. le2(0)) end
local function trade_item(count, itemid, slot, tidx) pcall(windower.packets.inject_outgoing, 0x34, string.char(0x34, 0x06, 0, 0) .. le4(count) .. le2(itemid) .. string.char(slot, tidx)) end
local function trade_kind(kind) pcall(windower.packets.inject_outgoing, 0x33, string.char(0x33, 0x06, 0, 0) .. le4(kind) .. le2(trade_counter) .. le2(0)) end

-- FFXI player names are a single capitalized word, so an exact get_mob_by_name is
-- case-sensitive. Resolve a user-typed name to the nearby PC case-insensitively,
-- with a prefix fallback so shorthand ("bay" -> "Bayld") also works.
function resolve_pc_mob(name, id)
    -- Prefer the server ID when we have it: Witness Protection (and any display-name addon) rewrites the shown
    -- NAME but never the entity ID, so an id lookup hits the right character even when this client shows a
    -- different name than Alexandria's stored real name. Fall back to the name scan when no id / not found.
    if id and tonumber(id) then
        local m = windower.ffxi.get_mob_by_id(tonumber(id))
        if m and m.id and not m.is_npc then return m end
    end
    if type(name) ~= 'string' or name == '' then return nil end
    local norm = name:sub(1, 1):upper() .. name:sub(2):lower()
    local mob = windower.ffxi.get_mob_by_name(norm)
    if mob and mob.id and not mob.is_npc then return mob end
    local lc = name:lower()
    local me = windower.ffxi.get_player()
    local myid = me and me.id
    local best, bestd
    for _, m in pairs(windower.ffxi.get_mob_array()) do
        if m and m.name and not m.is_npc and m.id ~= myid then
            local mn = m.name:lower()
            if mn == lc or mn:sub(1, #lc) == lc then
                local d = m.distance or math.huge
                if not bestd or d < bestd then best, bestd = m, d end
            end
        end
    end
    return best
end

function trade_begin(name, items, gil, id)
    if not packets_ok or trade_tx then return end
    local mob = resolve_pc_mob(name, id)
    if not mob or not mob.id then alex_chat(207, '[Alexandria] trade: ' .. tostring(name) .. ' not nearby', 'error') return end
    if not mob.distance or math.sqrt(mob.distance) > 6 then alex_chat(207, '[Alexandria] trade: target out of range', 'error') return end
    local entries = trade_expand(items or {})
    gil = math.max(0, math.floor(tonumber(gil) or 0))
    if gil > 0 then
        local have = (windower.ffxi.get_items() or {}).gil or 0
        if gil > have then gil = have end
    end
    if #entries == 0 and gil <= 0 then alex_chat(207, '[Alexandria] trade: nothing tradeable in inventory', 'error') return end
    trade_counter = 0
    trade_tx = { name = mob.name, id = mob.id, index = mob.index, entries = entries, gil = gil, gil_sent = (gil <= 0), idx = 0, tidx = 1, stage = 'offer', t = os.clock(), last = 0 }
    trade_result = nil
    trade_status_dirty = true
    if trade_debug then trade_log(('TX trade_begin target=%s id=%s entries=%s gil=%s'):format(tostring(name), tostring(mob.id), tostring(#entries), tostring(gil))) end
    trade_offer(mob.id, mob.index)
end

function build_tradestatus()
    if not trade_tx then
        return '{"t":"tradestatus","active":false' .. (trade_result and (',"result":"' .. trade_result .. '"') or '') .. '}\n'
    end
    local gilstep = (trade_tx.gil > 0) and 1 or 0
    local total = #trade_tx.entries + gilstep
    local done = ((trade_tx.gil > 0 and trade_tx.gil_sent) and 1 or 0) + trade_tx.idx
    if trade_tx.stage == 'done' then done = total end
    return ('{"t":"tradestatus","active":true,"stage":"%s","done":%d,"total":%d,"target":"%s"}\n'):format(trade_tx.stage, done, total, esc(trade_tx.name))
end

local function trade_tx_tick(now)
    if not trade_tx then return end
    if now - trade_tx.t > TRADE_TIMEOUT then trade_tx = nil; trade_result = 'timeout'; trade_status_dirty = true; return end
    if trade_tx.stage ~= 'items' or (now - trade_tx.last) < 0.4 then return end
    trade_tx.last = now
    if not trade_tx.gil_sent then
        trade_tx.gil_sent = true
        trade_item(trade_tx.gil, 0, 0, 0)
        trade_status_dirty = true
    elseif trade_tx.idx < #trade_tx.entries then
        trade_tx.idx = trade_tx.idx + 1
        local e = trade_tx.entries[trade_tx.idx]
        trade_item(e.count, e.id, e.slot, trade_tx.tidx)
        trade_tx.tidx = trade_tx.tidx + 1
        trade_status_dirty = true
    else
        trade_kind(2)
        trade_tx.stage = 'done'
        trade_status_dirty = true
    end
end

local function trade_trusted(rid, rmob)
    if trade_wl_ids[rid] then return true end
    if rmob and trade_wl[rmob.name] then return true end
    if trade_armed and (os.clock() - trade_armed.t) < TRADE_ARM_WINDOW
        and ((trade_armed.id and trade_armed.id == rid) or (rmob and trade_armed.name == rmob.name) or not rmob) then return true end
    return false
end

local function trade_on_incoming(id, data, injected)
    if id == 0x023 then
        trade_counter = rd_u16(data, 9)
    elseif id == 0x021 then
        if injected or not packets_ok or trade_tx then return end
        local rid = rd_u32(data, 5)
        local rmob = windower.ffxi.get_mob_by_id(rid)
        local ok = trade_trusted(rid, rmob)
        local me = windower.ffxi.get_mob_by_target('me')
        local st = me and me.status or 0
        if trade_debug then trade_log(('RX 0x021 rid=%s mob=%s trusted=%s st=%s'):format(tostring(rid), rmob and tostring(rmob.name) or 'nil', tostring(ok), tostring(st))) end
        if not ok then return end
        if st < 2 or st > 4 then
            trade_rx = { id = rid, opened = false, tried = false }
            trade_rx_t = os.clock()
            trade_counter = 0
        end
    elseif id == 0x022 then
        local kind = data:byte(9)
        local who = rd_u32(data, 5)
        if trade_debug then trade_log(('RX 0x022 kind=%s who=%s tx=%s rx=%s'):format(tostring(kind), tostring(who), trade_tx and 'y' or 'n', trade_rx and 'y' or 'n')) end
        if trade_tx and trade_tx.stage == 'offer' and kind == 0 then
            trade_tx.stage = 'items'
            trade_tx.last = 0
            trade_status_dirty = true
        elseif not trade_tx then
            if kind == 2 then
                local rmob = windower.ffxi.get_mob_by_id(who)
                if (trade_rx and trade_rx.id == who) or trade_trusted(who, rmob) then trade_kind(2) end
            else
                trade_counter = 0
                if kind == 0 and trade_rx then trade_rx.opened = true end
            end
        end
        if kind == 9 or kind == 1 or kind >= 4 then
            if trade_tx then trade_result = (kind == 9) and 'done' or (kind == 1) and 'cancelled' or 'failed'; trade_status_dirty = true end
            trade_tx = nil
            trade_rx = nil
            if not (trade_armed and trade_armed.id and trade_armed.id ~= who) then trade_armed = nil end
        end
    end
end

function shop_no_sale(id)
    return false
end

local function shop_buy_packet(idx, qty)
    return string.char(0x83, 0x08, 0, 0) .. le4(qty) .. le2(0) .. le2(idx) .. string.char(0, 0, 0, 0)
end

local function shop_do_sell(id, slot, qty)
    if not packets_ok then return end
    -- Only sell when a shop is actually open, or in the explicit sell-anywhere-in-town mode. Stops a pending
    -- sell that resolves after the shop closed (or a stale command) from firing shop packets off-menu.
    if not (shop_session or (sell_anywhere and in_town())) then return end
    pcall(windower.packets.inject_outgoing, 0x84, string.char(0x84, 0x06, 0, 0) .. le4(qty) .. le2(id) .. string.char(slot, 0))
    pcall(windower.packets.inject_outgoing, 0x85, string.char(0x85, 0x04, 0, 0, 1, 0, 0, 0))
end

function shop_stack_for_idx(idx)
    local it = shop.items[idx]
    local stack = (it and res.items[it.id] and res.items[it.id].stack) or 1
    if stack < 1 then stack = 1 end
    return stack
end

function shop_buy(idx, qty)
    if not packets_ok then return false end
    if not shop_session then return false end -- can't buy without an open shop
    qty = math.min(math.max(1, tonumber(qty) or 1), shop_stack_for_idx(idx))
    pcall(windower.packets.inject_outgoing, 0x83, shop_buy_packet(idx, qty))
    return true
end

function shop_buy_qty(idx, total)
    if not packets_ok or not shop.items[idx] then return false end
    local id = shop.items[idx].id
    local stack = shop_stack_for_idx(idx)
    total = math.max(1, tonumber(total) or 1)
    local function buy_next(remaining)
        if remaining <= 0 or not shop.items[idx] then return end
        local q = math.min(remaining, stack)
        local before = shop_count_inv(id)
        shop_buy(idx, q)
        local t0 = os.clock()
        local function check()
            if not shop.items[idx] then return end
            local got = shop_count_inv(id) - before
            if got > 0 then
                coroutine.schedule(function() buy_next(remaining - got) end, 0.3)
            elseif os.clock() - t0 > 4 then
                return
            else
                coroutine.schedule(check, 0.3)
            end
        end
        coroutine.schedule(check, 0.4)
    end
    buy_next(total)
    return true
end

function shop_sell_by_id(id, qty)
    if not packets_ok then return false end
    local inv = windower.ffxi.get_items(0)
    if not inv or shop_no_sale(id) then return false end
    for s = 1, (inv.max or 80) do
        local it = inv[s]
        if type(it) == 'table' and it.id == id and it.status == 0 then
            shop_do_sell(id, s, math.min(qty, it.count or 1))
            return true
        end
    end
    return false
end

function shop_count_inv(id)
    local inv = windower.ffxi.get_items(0)
    local n = 0
    if inv then
        for s = 1, (inv.max or 80) do
            local it = inv[s]
            if type(it) == 'table' and it.id == id then n = n + (it.count or 0) end
        end
    end
    return n
end

function shop_sell_amount(id, qty)
    if not packets_ok or shop_no_sale(id) then return end
    local inv = windower.ffxi.get_items(0)
    if not inv then return end
    local remaining = qty
    for s = 1, (inv.max or 80) do
        if remaining <= 0 then break end
        local it = inv[s]
        if type(it) == 'table' and it.id == id and it.status == 0 then
            local n = math.min(remaining, it.count or 1)
            shop_do_sell(id, s, n)
            remaining = remaining - n
        end
    end
end

function shop_sell_request(id, qty, from_bag, slot)
    if not packets_ok then return end
    if shop_no_sale(id) then alex_chat(207, '[Alexandria] that item cannot be sold', 'error') return end
    qty = math.max(1, qty or 1)
    if from_bag and from_bag ~= 0 then
        local di = windower.ffxi.get_bag_info(0)
        if di and (di.max - di.count) <= 0 then alex_chat(207, '[Alexandria] inventory full; cannot move that item to sell', 'error') return end
        local items = windower.ffxi.get_items(from_bag)
        local it = slot and type(items) == 'table' and items[slot]
        if not (type(it) == 'table' and it.id == id and it.id ~= 0) then
            if slot then alex_chat(207, '[Alexandria] item no longer in that slot; sell skipped', 'error') return end
            local m = find_in_bag(from_bag, id, nil)
            if not m then alex_chat(207, '[Alexandria] item not found in that bag', 'error') return end
            slot = m.slot
            it = type(items) == 'table' and items[slot]
        end
        local mv = math.min(qty, (type(it) == 'table' and it.count) or qty)
        local before = shop_count_inv(id)
        windower.ffxi.move_item(from_bag, 0, slot, mv)
        shop_pending_sell = { id = id, qty = mv, before = before, t = os.clock() }
    elseif slot then
        local inv = windower.ffxi.get_items(0)
        local it = type(inv) == 'table' and inv[slot]
        if type(it) == 'table' and it.id == id and it.status == 0 then shop_do_sell(id, slot, math.min(qty, it.count or 1)) return end
        alex_chat(207, '[Alexandria] item no longer in that slot; sell skipped', 'error')
    else
        shop_sell_amount(id, qty)
    end
end

-- ===== Store Materials (MassTrade-style zone-wide NPC trade) ==========================
-- Trades up to 8 inventory slots per 0x036 packet, sent from anywhere in the NPC's zone
-- (no proximity / targeting). Loops for >8 slots and auto-pulls from carry bags first.
-- All 8 crystals + 8 clusters. Shared by every NPC that accepts the full elemental set.
STORE_CRYSTAL_CLUSTERS = { 'Fire Crystal', 'Ice Crystal', 'Wind Crystal', 'Earth Crystal', 'Lightning Crystal', 'Water Crystal', 'Light Crystal', 'Dark Crystal', 'Fire Cluster', 'Ice Cluster', 'Wind Cluster', 'Earth Cluster', 'Lightning Cluster', 'Water Cluster', 'Light Cluster', 'Dark Cluster' }
STORE_CATALOG = {
    { npc = 'Monisette',        items = { "Rem's Tale Ch.1", "Rem's Tale Ch.2", "Rem's Tale Ch.3", "Rem's Tale Ch.4", "Rem's Tale Ch.5", "Rem's Tale Ch.6", "Rem's Tale Ch.7", "Rem's Tale Ch.8", "Rem's Tale Ch.9", "Rem's Tale Ch.10" } },
    { npc = 'Oboro',            items = { 'Pluton', 'Beitetsu', 'Riftborn Boulder' } },
    { npc = 'Paparoon',         items = { 'Alexandrite' } },
    { npc = 'Shami',            items = { "Beastmen's Seal", "Kindred's Seal", "Kindred's Crest", 'H. Kindred Crest', 'S. Kindred Crest' } },
    { npc = 'Oseem',            items = { 'Pellucid Stone', 'Fern Stone', 'Taupe Stone' } },
    { npc = 'Ephemeral Moogle', items = STORE_CRYSTAL_CLUSTERS },
    -- Waypoint / Proto-Waypoint accept the same crystals/clusters. They come in MULTIPLE
    -- per zone, so store_find_npc resolves them to the NEAREST in range (STORE_NEAREST_NAMES),
    -- never zone-gate/cache, so a trade always targets the one you're standing at.
    { npc = 'Waypoint',         items = STORE_CRYSTAL_CLUSTERS },
    { npc = 'Proto-Waypoint',   items = STORE_CRYSTAL_CLUSTERS },
}
STORE_CARRY_BAGS = { 0, 5, 6, 7 }
function store_bags()
    local b = { 0, 5, 6, 7 }
    local info = windower.ffxi.get_info()
    if info and info.mog_house then b[#b + 1] = 1; b[#b + 1] = 2; b[#b + 1] = 4; b[#b + 1] = 9 end
    return b
end
function store_noninv_bags()
    local out = {}
    for _, x in ipairs(store_bags()) do if x ~= 0 then out[#out + 1] = x end end
    return out
end
store_run = nil
store_q = {}
store_dirty = false
store_id_cache = nil
store_last_zone = -1
store_npc_cache = {}
store_wp_near_key = ''
store_close_until = 0
store_released = false

-- NPCs that appear MANY times per zone (Waypoints): resolved to the NEAREST in-range
-- instance in both modes, never by the fixed zone-gate / name-cache path (which assumes
-- one NPC per name and would pin an arbitrary, possibly-distant one).
STORE_NEAREST_NAMES = { ['Waypoint'] = true, ['Proto-Waypoint'] = true }

STORE_FIXED_NPCS = {
    ['Monisette'] = { zone = 246, id = 17784989, index = 157 },
    ['Ruspix']    = { zone = 281, id = 17928266, index = 74 },
    ['Coelestrox'] = { zone = 291, id = 17970039, index = 887 },
    ['Oboro']     = { zone = 246, id = 17784988, index = 156 },
    ['Paparoon']  = { zone = 53,  id = 16994398, index = 94 },
    ['Shami']     = { zone = 246, id = 17784905, index = 73 },
    ['Oseem']     = { zone = 252, id = 17809551, index = 143 },
    ['Detrovio']        = { zone = 256, id = 17826148, index = 356 },
    ['Divainy-Gamainy'] = { zone = 256, id = 17826144, index = 352 },
    ['Gorpa-Masorpa']   = { zone = 249, id = 17797274, index = 154 },
}

store_discovered = {}

-- Every "* Coffer Key" (the AF dungeon coffer keys), from Windower res.items. Shared by
-- the Gobbie Mystery Box NPCs below, which all accept the full set.
STORE_COFFER_KEYS = { 1042, 1043, 1044, 1045, 1046, 1047, 1048, 1049, 1050, 1051, 1052, 1053, 1054, 1057, 1058, 1059, 1060, 1063 }
-- SP Gobbie Key is USED at the same Gobbie Mystery Box goblins (not stored). Listing it here
-- makes it appear in those goblins' Store sections; store_enqueue routes it to the box-menu
-- flow (gobbie_*) instead of a plain trade.
SPKEY_ID = 8973
STORE_COFFER_KEYS[#STORE_COFFER_KEYS + 1] = SPKEY_ID

STORE_DEFAULTS = {
    ['Isakoth']    = { zone = 235, id = 17739953, index = 177, items = { 8711 } },
    ['Aurix']      = { zone = 243, id = 17772865, index = 321, items = { 9538, 9540, 9542 }, batch = 100 },  -- Rusted I. Card, Black. I. Card, Old I. Card (Ru'Lude Gardens; NPC also appears as "???")
    ['Greyson']    = { zone = 245, id = 17781000, index = 264, items = { 9277 } },
    ['Haggleblix'] = { zone = 147, id = 17379846, index = 518, items = { 1455 }, batch = 100 },
    ['Divainy-Gamainy'] = { zone = 256, id = 17826144, index = 352, items = { 3951, 3952, 3953, 3954, 3955, 3956, 4033, 4034, 4035, 8930, 8931, 8932, 8939, 8940, 8941, 8948, 8949, 8950, 8957, 8958, 8959, 8933, 8934, 8935, 8942, 8943, 8944, 8951, 8952, 8953, 8960, 8961, 8962, 8936, 8937, 8938, 8945, 8946, 8947, 8954, 8955, 8956, 8963, 8964, 8965 } },  -- Skirmish stones: Ghastly/Wailing/Verdigris + Snow/Leaf/Dusk (slit/tip/dim/orb), each base/+1/+2
    ['Eternal Flame']   = { zone = 256, id = 17826104, index = 312, items = { 8711 } },  -- Copper Voucher
    ['Fhelm Jobeizat']  = { zone = 241, id = 17764603, index = 251, items = { 8711 } },  -- Copper Voucher
    ['Lola']            = { zone = 257, id = 17830190, index = 302, items = { 4036, 3950 } },  -- Lebondopt Wing, Pulchridopt Wing (Mellidopt Wing goes to the ??? at Yorcia, not Lola)
    ['Rolandienne']     = { zone = 230, id = 17719638, index = 342, items = { 8711 } },  -- Copper Voucher
    ['Antiqix']         = { zone = 151, id = 17396217, index = 505, items = { 1449 }, batch = 100 },  -- T. Whiteshell (Castle Oztroja)
    ['Lootblox']        = { zone = 149, id = 17388036, index = 516, items = { 1452 }, batch = 100 },  -- O. Bronzepiece -> M. Silverpiece (Davoi)
    ['??? (Yorcia)']    = { zone = 263, id = 17855118, index = 654, items = { 9050 } },  -- Mellidopt Wing (nameless NPC in Yorcia Weald; normal trade amounts, not batched; distinct key so it never merges with Aurix's "???")
    -- Gobbie Mystery Box NPCs (one per city) accept every coffer key. Enumerated from the
    -- entity DATs; ids derive from zone+index. All share STORE_COFFER_KEYS.
    ['Habitox']    = { zone = 232, id = 17727634, index = 146, items = STORE_COFFER_KEYS },  -- Port San d'Oria
    ['Mystrix']    = { zone = 230, id = 17719641, index = 345, items = STORE_COFFER_KEYS },  -- Southern San d'Oria
    ['Bountibox']  = { zone = 234, id = 17735872, index = 192, items = STORE_COFFER_KEYS },  -- Bastok Mines
    ['Specilox']   = { zone = 235, id = 17739956, index = 180, items = STORE_COFFER_KEYS },  -- Bastok Markets
    ['Arbitrix']   = { zone = 239, id = 17756351, index = 191, items = STORE_COFFER_KEYS },  -- Windurst Walls
    ['Funtrox']    = { zone = 241, id = 17764606, index = 254, items = STORE_COFFER_KEYS },  -- Windurst Woods
    ['Sweepstox']  = { zone = 245, id = 17780998, index = 262, items = STORE_COFFER_KEYS },  -- Lower Jeuno
    ['Priztrix']   = { zone = 244, id = 17776886, index = 246, items = STORE_COFFER_KEYS },  -- Upper Jeuno
    ['Wondrix']    = { zone = 50,  id = 16982640, index = 624, items = STORE_COFFER_KEYS },  -- Aht Urhgan Whitegate
    ['Rewardox']   = { zone = 256, id = 17826177, index = 385, items = STORE_COFFER_KEYS },  -- Western Adoulin
    ['Winrix']     = { zone = 257, id = 17830187, index = 299, items = STORE_COFFER_KEYS },  -- Eastern Adoulin
    ['Anomaly Expert'] = { zone = 257, id = 17830191, index = 303, items = { 3960, 3961, 3962, 8755, 8756, 8757 } },  -- Yggrete stones: Celadon, Zaffre, Alizarin, Phlox, Russet, Aster (Eastern Adoulin)
}

function store_merge_entry(name, e)
    if type(e) ~= 'table' then return end
    local me = store_discovered[name]
    if type(me) ~= 'table' then me = { items = {} }; store_discovered[name] = me end
    me.items = me.items or {}
    local have = {}
    for _, x in ipairs(me.items) do have[x] = true end
    for _, x in ipairs(e.items or {}) do if not have[x] then me.items[#me.items + 1] = x; have[x] = true end end
    if me.batch == nil then me.batch = e.batch end
    me.zone = me.zone or e.zone
    me.id = me.id or e.id
    me.index = me.index or e.index
    if me.id and me.index and me.zone then
        if not STORE_FIXED_NPCS[name] then
            STORE_FIXED_NPCS[name] = { zone = me.zone, id = me.id, index = me.index, batch = me.batch }
        elseif me.batch and not STORE_FIXED_NPCS[name].batch then
            STORE_FIXED_NPCS[name].batch = me.batch
        end
    end
end

function store_save_discovered()
    if not json_ok then return end
    local rf = io.open(windower.addon_path .. 'data/store_discovered.json', 'r')
    if rf then
        local raw = rf:read('*a'); rf:close()
        if raw and #raw > 0 then
            local dok, disk = pcall(json.decode, raw)
            if dok and type(disk) == 'table' then
                for name, de in pairs(disk) do store_merge_entry(name, de) end
            end
        end
    end
    local ok, enc = pcall(json.encode, store_discovered, { indent = true })
    if ok and enc then
        local wf = io.open(windower.addon_path .. 'data/store_discovered.json', 'w')
        if wf then wf:write(enc); wf:close() end
    end
end

-- Fold a finished capture into store_discovered + STORE_FIXED_NPCS, and return a summary. Only
-- `//ax learn done` commits; `//ax capture stop` passes no_commit=true because it is a pure packet
-- recorder (reforge/misc trades) and must NEVER register the NPC as a storage location.
function store_capture_commit(c, no_commit)
    local npcname = c.label or c.tname
    if not npcname and c.npc.id then local m = windower.ffxi.get_mob_by_id(c.npc.id); npcname = m and m.name end
    npcname = npcname or 'UnknownNPC'
    local eid = c.tid or c.npc.id
    local eidx = c.tindex or c.npc.index
    -- Many FFXI NPCs share the name "???"; keying by name alone merges two different
    -- ??? NPCs (different index) into one entry. Qualify nameless captures by zone/index
    -- so they stay distinct. An explicit //ax capture <label> still takes precedence.
    if not c.label and (npcname == '???' or npcname == '') and eidx then
        npcname = ('??? (z%d i%d)'):format(c.zone or 0, eidx)
    end
    local item_ids = {}
    for iid in pairs(c.items) do item_ids[#item_ids + 1] = iid end
    local item_names = {}
    for _, iid in ipairs(item_ids) do item_names[#item_names + 1] = (res.items[iid] and res.items[iid].en) or ('item ' .. iid) end
    local saved, added = false, 0
    if not no_commit and eid and eidx and #item_ids > 0 then
        local d = store_discovered[npcname]
        if type(d) ~= 'table' then d = { items = {} }; store_discovered[npcname] = d end
        d.zone, d.id, d.index = c.zone, eid, eidx
        if c.batch and c.batch > 1 then d.batch = c.batch end
        d.items = d.items or {}
        local have = {}
        for _, x in ipairs(d.items) do have[x] = true end
        for _, iid in ipairs(item_ids) do if not have[iid] then d.items[#d.items + 1] = iid; have[iid] = true; added = added + 1 end end
        if not STORE_FIXED_NPCS[npcname] then STORE_FIXED_NPCS[npcname] = { zone = c.zone, id = eid, index = eidx } end
        STORE_FIXED_NPCS[npcname].batch = d.batch
        store_save_discovered()
        store_dirty = true
        saved = true
        -- Propagate the newly learned NPC to every other connected character so the whole
        -- fleet can store to it immediately. The desktop rebroadcasts this as `storeadd`.
        if type(c.zone) == 'number' then
            local iparts = {}
            for _, iid in ipairs(d.items) do iparts[#iparts + 1] = tostring(iid) end
            queue_send('{"t":"storelearn","npc":"' .. esc(npcname) .. '","zone":' .. c.zone .. ',"id":' .. eid .. ',"index":' .. eidx .. ',"items":[' .. table.concat(iparts, ',') .. ']' .. (d.batch and (',"batch":' .. d.batch) or '') .. '}\n')
        end
    end
    return { npcname = npcname, eid = eid, eidx = eidx, item_names = item_names, primary = item_names[1] or 'no-item', saved = saved, added = added }
end

-- Write every user-discovered (non-builtin) storage NPC to one clean, shareable file.
-- Returns count and the full path, or 0/nil if there is nothing new to share.
function store_share_write()
    local lines, n = {}, 0
    for name, e in pairs(store_discovered) do
        if type(e) == 'table' and e.id and e.index and e.zone then
            -- Share NPCs the dev has no built-in for, AND built-ins the user taught NEW items for
            -- (so additions to a built-in like extra stones make it back to the dev instead of being
            -- silently dropped). newnames = the items this NPC has beyond its built-in default.
            local def = STORE_DEFAULTS[name]
            local defhave = {}
            if type(def) == 'table' then for _, iid in ipairs(def.items or {}) do defhave[iid] = true end end
            local newnames = {}
            for _, iid in ipairs(e.items or {}) do if not defhave[iid] then newnames[#newnames + 1] = (res.items[iid] and res.items[iid].en) or ('item ' .. iid) end end
            if not def or #newnames > 0 then
                local ids, names = {}, {}
                for _, iid in ipairs(e.items or {}) do
                    ids[#ids + 1] = tostring(iid)
                    names[#names + 1] = (res.items[iid] and res.items[iid].en) or ('item ' .. iid)
                end
                local bpart = e.batch and (', batch = ' .. e.batch) or ''
                local note = def and (' -- built-in + new: ' .. table.concat(newnames, ', ')) or ('  -- ' .. table.concat(names, ', '))
                lines[#lines + 1] = ("    ['%s'] = { zone = %d, id = %d, index = %d, items = { %s }%s },%s"):format(
                    name, e.zone, e.id, e.index, table.concat(ids, ', '), bpart, note)
                n = n + 1
            end
        end
    end
    if n == 0 then return 0, nil end
    table.sort(lines)
    local path = windower.addon_path .. 'data/storage_npcs_to_share.txt'
    local f = io.open(path, 'w')
    if f then
        f:write('-- Alexandria storage NPCs you discovered. Send this whole file to the developer.\n\n')
        f:write(table.concat(lines, '\n') .. '\n')
        f:close()
    end
    return n, path
end

function store_load_discovered()
    store_discovered = {}
    local disk = {}
    local f = io.open(windower.addon_path .. 'data/store_discovered.json', 'r')
    if f then
        local raw = f:read('*a'); f:close()
        if json_ok and raw and #raw > 0 then
            local ok, d = pcall(json.decode, raw)
            if ok and type(d) == 'table' then disk = d end
        end
    end
    for name, e in pairs(disk) do store_merge_entry(name, e) end
    for name, e in pairs(STORE_DEFAULTS) do store_merge_entry(name, e) end
end
store_load_discovered()

store_debug = false
function store_dbg(msg)
    if store_debug then alex_chat(160, '[store] ' .. msg, 'action') end
end
function store_live_npc(name)
    local arr = windower.ffxi.get_mob_array()
    if not arr then return nil end
    for _, v in pairs(arr) do
        if type(v) == 'table' and v.name == name and v.id and v.id > 0 then return v.id, v.index, v.distance end
    end
    return nil
end

function store_item_id(name)
    if not store_id_cache then
        store_id_cache = {}
        for id, r in pairs(res.items) do
            if type(r) == 'table' then
                if r.enl then store_id_cache[r.enl:lower()] = id end
                if r.en then store_id_cache[r.en:lower()] = id end
            end
        end
    end
    return store_id_cache[name:lower()]
end

-- Static NPCs have fixed server entity ids per zone (MassTrade model): gate purely on zone,
-- never touch the mob array, so they never flicker as the client culls distant entities.
-- Location-variable NPCs (Ephemeral Moogle) fall back to a name scan cached per zone.
function store_find_npc(name)
    -- Multi-instance NPCs (several Waypoints per zone): always target the closest one
    -- within trade range from the live mob array, in both modes. Bypasses the zone-gate /
    -- name-cache below so we never pin (and trade to) a far instance.
    if STORE_NEAREST_NAMES[name] then
        local arr = windower.ffxi.get_mob_array()
        if not arr then return nil end
        local best_id, best_idx, best_d
        for _, v in pairs(arr) do
            if type(v) == 'table' and v.name == name and v.id and v.id > 0 and v.index and v.distance then
                local d = math.sqrt(v.distance)
                if d <= 6 and (not best_d or d < best_d) then best_id, best_idx, best_d = v.id, v.index, d end
            end
        end
        return best_id, best_idx
    end
    local fx = STORE_FIXED_NPCS[name]
    if fx then
        if experimental_features then
            if store_last_zone == fx.zone then return fx.id, fx.index end
            return nil
        end
        local m = windower.ffxi.get_mob_by_id(fx.id)
        if m and m.distance and math.sqrt(m.distance) <= 6 then return fx.id, fx.index end
        return nil
    end
    if experimental_features then
        local c = store_npc_cache[name]
        if c then return c.id, c.index end
    end
    local arr = windower.ffxi.get_mob_array()
    if not arr then return nil end
    for _, v in pairs(arr) do
        if type(v) == 'table' and v.name == name and v.id and v.index and v.id > 0 then
            if experimental_features then
                store_npc_cache[name] = { id = v.id, index = v.index }
                return v.id, v.index
            elseif v.distance and math.sqrt(v.distance) <= 6 then
                return v.id, v.index
            end
        end
    end
    return nil
end

function store_count(id, bags)
    local n = 0
    for _, bag in ipairs(bags) do
        local inv = windower.ffxi.get_items(bag)
        if type(inv) == 'table' then
            for s = 1, (inv.max or 80) do
                local it = inv[s]
                if type(it) == 'table' and it.id == id and it.status == 0 then n = n + (it.count or 0) end
            end
        end
    end
    return n
end

-- Up to max_slots inventory slots of id, totaling <= max_count, as {slot=, count=}.
function store_inv_slots(id, max_slots, max_count)
    local inv = windower.ffxi.get_items(0)
    local out = {}
    local remaining = max_count
    if not inv then return out end
    for s = 1, (inv.max or 80) do
        if #out >= max_slots or remaining <= 0 then break end
        local it = inv[s]
        if type(it) == 'table' and it.id == id and it.status == 0 and (it.count or 0) > 0 then
            local n = math.min(it.count, remaining)
            out[#out + 1] = { slot = it.slot or s, count = n }
            remaining = remaining - n
        end
    end
    return out
end

function store_pull(id, n_slots)
    local moved = 0
    for _, bag in ipairs(store_noninv_bags()) do
        if moved >= n_slots then break end
        local inv = windower.ffxi.get_items(bag)
        if type(inv) == 'table' then
            for s = 1, (inv.max or 80) do
                if moved >= n_slots then break end
                local it = inv[s]
                if type(it) == 'table' and it.id == id and it.id ~= 0 then
                    windower.ffxi.move_item(bag, 0, it.slot or s, it.count or 1)
                    moved = moved + 1
                end
            end
        end
    end
    return moved
end

function store_trade(npc_id, npc_index, slots)
    if not packets_ok then return false end
    local body = string.char(0x36, 0x20, 0, 0) .. le4(npc_id)
    for i = 1, 10 do local s = slots[i]; body = body .. le4((s and s.count) or 0) end
    for i = 1, 10 do local s = slots[i]; body = body .. string.char(((s and s.slot) or 0) % 256) end
    body = body .. le2(npc_index) .. string.char(#slots % 256, 0, 0, 0)
    local ok, err = pcall(windower.packets.inject_outgoing, 0x36, body)
    store_dbg(('raw 0x036 len=%d npc=%d idx=%d slots=%d inject=%s'):format(#body, npc_id, npc_index or -1, #slots, ok and 'ok' or ('ERR ' .. tostring(err))))
    return ok
end

function store_inv_free()
    local di = windower.ffxi.get_bag_info(0)
    return di and ((di.max or 80) - (di.count or 0)) or 0
end

function store_finish()
    local r = store_run
    store_run = nil
    if r then
        store_dbg(('finish: phase=%s done=%d want=%d'):format(r.phase or '?', r.done or 0, r.want or 0))
        if r.traded and store_close_until == 0 then store_close_until = os.clock() + 6 end
        alex_chat(207, ('[Alexandria] Stored %d %s'):format(r.done or 0, r.name or 'item'), 'action')
        emit_store(false, r.id or 0, r.done or 0, r.want or 0, 'done')
        if r.drop_extra and r.rem_ch then store_drop_arm(r.rem_ch, r.id) end
    end
    store_dirty = true
end

-- Drop Extra: after a Monisette / Rem's Tale store finishes, discard the un-storable remainder -- but
-- ONLY once the 0x113 currency (which storing refreshes) confirms the chapter is genuinely at the 255
-- cap, so we never toss items that failed to store for another reason (e.g. walking out of range). A
-- short settle lets that currency land; the actual dropping rides the paced drain_drops queue. FIFO
-- queued so a "Store All" spanning several chapters resolves each one independently.
store_drop_q = {}

function store_drop_arm(ch, id)
    store_drop_q[#store_drop_q + 1] = { ch = ch, id = id, deadline = os.clock() + 1.2, hard = os.clock() + 4 }
    currency_request()
end

function store_drop_tick()
    local p = store_drop_q[1]
    if not p then return end
    if os.clock() < p.deadline then return end
    if not rem_currency_ready() and os.clock() < p.hard then return end  -- wait for a fresh page, up to the hard cap
    table.remove(store_drop_q, 1)
    if rem_stored_count(p.ch) < 255 then return end        -- not at the cap: nothing is excess, never drop
    local inv = windower.ffxi.get_items(0)
    if type(inv) ~= 'table' then return end
    for s = 1, (inv.max or 80) do
        local it = inv[s]
        if type(it) == 'table' and it.id == p.id and (it.count or 0) > 0 and it.status == 0 then
            enqueue_drop(it.slot or s, p.id)
        end
    end
end

function store_menu_close()
    if not (packets_ok and npc_menu) then return end
    local m = npc_menu
    pcall(function()
        packets.inject(packets.new('outgoing', 0x05B, {
            ['Target'] = m.id, ['Option Index'] = 0, ['_unknown1'] = 0,
            ['Target Index'] = m.index, ['Automated Message'] = false,
            ['_unknown2'] = 0, ['Zone'] = m.zone, ['Menu ID'] = m.menu,
        }))
    end)
    store_dbg(('store close menu=%d tgt=%d idx=%d'):format(m.menu or -1, m.id or -1, m.index or -1))
end

capture = nil
CAPTURE_IDS = { [0x016] = 1, [0x01A] = 1, [0x01E] = 1, [0x020] = 1, [0x032] = 1, [0x033] = 1, [0x034] = 1, [0x036] = 1, [0x04B] = 1, [0x052] = 1, [0x05B] = 1, [0x05C] = 1, [0x118] = 1 }

function capture_record(dir, id, data)
    if not capture or not CAPTURE_IDS[id] then return end
    if not capture.tname then
        local tgt = windower.ffxi.get_mob_by_target('t')
        if tgt and tgt.name and tgt.name ~= '' then capture.tname = tgt.name; capture.tid = tgt.id; capture.tindex = tgt.index end
    end
    local note = ''
    if dir == 'in' and packets_ok and (id == 0x032 or id == 0x033 or id == 0x034) then
        local ok, p = pcall(packets.parse, 'incoming', data)
        if ok and p and p['Menu ID'] and p['NPC'] then
            capture.npc = { id = p['NPC'], index = p['NPC Index'], zone = p['Zone'] or capture.zone, menu = p['Menu ID'] }
            note = ('menu=%s npc=%s index=%s zone=%s'):format(tostring(p['Menu ID']), tostring(p['NPC']), tostring(p['NPC Index']), tostring(p['Zone']))
        end
    elseif dir == 'out' and id == 0x036 then
        local nid = rd_u32(data, 5)
        note = ('trade to npc_id=%s'):format(tostring(nid))
        if not capture.npc.id then capture.npc.id = nid end
        local inv = windower.ffxi.get_items(0)
        local names = {}
        for i = 0, 9 do
            local slot = data:byte(49 + i)
            if slot and slot > 0 and type(inv) == 'table' and type(inv[slot]) == 'table' and inv[slot].id and inv[slot].id ~= 0 then
                capture.items[inv[slot].id] = true
                local r = res.items[inv[slot].id]
                names[#names + 1] = (r and r.en) or ('item ' .. inv[slot].id)
            end
        end
        if #names > 0 then note = note .. '  items=' .. table.concat(names, ', ') end
    elseif dir == 'out' and packets_ok and (id == 0x05B or id == 0x05C) then
        local ok, p = pcall(packets.parse, 'outgoing', data)
        if ok and p then note = ('option=%s menu=%s target_index=%s'):format(tostring(p['Option Index']), tostring(p['Menu ID']), tostring(p['Target Index'])) end
    end
    capture.events[#capture.events + 1] = { dir = dir, id = id, t = os.clock() - capture.t0, len = #data, hex = dbox_hex(data), note = note }
    if #capture.events > 500 then table.remove(capture.events, 1) end
end

function store_begin(npc, id, want, drop)
    if store_run then return end
    if not packets_ok then alex_chat(207, '[Alexandria] packets unavailable', 'error') return end
    local nid, nidx = store_find_npc(npc)
    if not nid then alex_chat(207, '[Alexandria] ' .. npc .. ' is not in this zone', 'error') return end
    local entry = STORE_FIXED_NPCS[npc]
    local batch = entry and tonumber(entry.batch)
    if batch and batch > 1 then
        want = math.floor(want / batch) * batch
        if want < batch then alex_chat(207, ('[Alexandria] %s only accepts batches of %d'):format(npc, batch), 'error') return end
    end
    -- Drop Extra (Monisette / Rem's Tale only): cap the trade at the 255-per-chapter storage limit and
    -- flag the run so the un-storable remainder is discarded once the store completes.
    local rem_ch = nil
    if drop and npc == 'Monisette' and id > REM_ITEM_BASE and id <= REM_ITEM_BASE + 10 then
        rem_ch = id - REM_ITEM_BASE
        currency_request()  -- refresh stored counts so the cap math is accurate
        if rem_currency_ready() then want = math.min(want, math.max(0, 255 - rem_stored_count(rem_ch))) end
        if want <= 0 then store_drop_arm(rem_ch, id) return end  -- already maxed: skip the store, just drop the excess
    end
    local r = res.items[id]
    local zinfo = windower.ffxi.get_info()
    local lid, lidx, ldist = store_live_npc(npc)
    store_dbg(('begin %s id=%d want=%d zone=%s resolved id=%d idx=%d'):format(
        npc, id, want, tostring(zinfo and zinfo.zone), nid, nidx or -1))
    if lid then
        store_dbg(('live mob: id=%d idx=%d dist=%.1f  %s'):format(
            lid, lidx or -1, ldist and math.sqrt(ldist) or -1, (lid == nid and lidx == nidx) and 'MATCH' or 'MISMATCH<<<'))
    else
        store_dbg('live mob: not in array (using hardcoded id)')
    end
    store_dbg(('inv count=%d  noninv count=%d  packets_ok=%s'):format(
        store_count(id, { 0 }), store_count(id, store_noninv_bags()), tostring(packets_ok)))
    store_run = { npc = npc, npc_id = nid, npc_index = nidx, id = id, name = (r and r.en) or ('item ' .. id),
        want = want, done = 0, phase = 'trade', t = os.clock(), start = os.clock(),
        batch_req = (batch and batch > 1) and batch or nil,
        drop_extra = rem_ch ~= nil, rem_ch = rem_ch }
    alex_chat(207, ('[Alexandria] Storing %s -> %s...'):format(store_run.name, npc), 'action')
    emit_store(true, id, 0, want, 'storing')
end

function store_enqueue(npc, id, want, drop)
    if id == SPKEY_ID then gobbie_enqueue(npc, want) return end
    if store_run and store_run.npc == npc and store_run.id == id then return end
    for _, q in ipairs(store_q) do
        if q.npc == npc and q.id == id then q.want = math.max(q.want, want); q.drop = q.drop or drop; return end
    end
    if store_run then
        store_q[#store_q + 1] = { npc = npc, id = id, want = want, drop = drop }
    else
        store_begin(npc, id, want, drop)
    end
end

function store_tick(now)
    if not store_run then
        if #store_q > 0 and (store_released or now >= store_close_until) then
            local nxt = table.remove(store_q, 1)
            store_close_until = 0
            store_released = false
            store_begin(nxt.npc, nxt.id, nxt.want, nxt.drop)
        end
        return
    end
    local r = store_run
    if now - r.start > 120 then store_dbg('global 120s timeout'); store_finish() return end

    if r.phase == 'trade' then
        if now - r.t < 0.3 then return end
        local inv_n = store_count(r.id, { 0 })
        if inv_n == 0 then
            local non = store_count(r.id, store_noninv_bags())
            store_dbg(('trade: inv=0 noninv=%d -> %s'):format(non, non > 0 and 'pull' or 'finish'))
            if non > 0 then r.phase = 'pull'; r.t = now else store_finish() end
            return
        end
        local remaining = math.max(0, r.want - r.done)
        if remaining == 0 then store_dbg('trade: remaining=0 -> finish'); store_finish() return end
        local want_now = remaining
        if r.batch_req then
            if inv_n < r.batch_req then
                local total = inv_n + store_count(r.id, store_noninv_bags())
                if total < r.batch_req then store_dbg(('batch: %d < %d, cannot complete a batch -> finish'):format(total, r.batch_req)); store_finish() return end
                store_dbg(('batch: inv=%d < %d -> pull'):format(inv_n, r.batch_req)); r.phase = 'pull'; r.t = now; return
            end
            want_now = r.batch_req
        end
        local slots = store_inv_slots(r.id, r.batch_req and 10 or 8, want_now)
        if #slots == 0 then store_dbg('trade: 0 slots -> finish'); store_finish() return end
        local batch = 0
        for _, s in ipairs(slots) do batch = batch + s.count end
        if r.batch_req and batch < r.batch_req then store_dbg(('batch: gathered %d < %d -> finish'):format(batch, r.batch_req)); store_finish() return end
        r.before = inv_n
        r.batch = batch
        local sd = {}
        for _, s in ipairs(slots) do sd[#sd + 1] = ('slot %d x%d'):format(s.slot, s.count) end
        store_dbg(('trade: inv=%d remaining=%d batch=%d slots=[%s] -> inject 0x036 to id=%d idx=%d'):format(
            inv_n, remaining, batch, table.concat(sd, ', '), r.npc_id, r.npc_index or -1))
        store_trade(r.npc_id, r.npc_index, slots)
        r.traded = true
        r.phase = 'wait'; r.t = now
    elseif r.phase == 'wait' then
        local inv_n = store_count(r.id, { 0 })
        if inv_n <= r.before - r.batch then
            r.done = r.done + r.batch
            store_dbg(('wait: inv=%d (before=%d batch=%d) CONFIRMED done=%d'):format(inv_n, r.before, r.batch, r.done))
            emit_store(true, r.id, r.done, r.want, 'storing')
            store_close_until = os.clock() + 6
            store_released = false
            if r.done >= r.want then store_finish() else r.phase = 'cooldown'; r.t = now end
        elseif now - r.t > 6 then
            store_dbg(('wait: TIMEOUT inv=%d still > before(%d)-batch(%d)=%d, trade not accepted'):format(
                inv_n, r.before, r.batch, r.before - r.batch))
            store_finish()
        end
    elseif r.phase == 'cooldown' then
        if store_released or now - r.t > 4 then
            store_dbg(('cooldown done (%s) -> next batch'):format(store_released and 'released' or 'timeout'))
            store_released = false
            r.phase = 'trade'; r.t = now
        end
    elseif r.phase == 'pull' then
        local free = store_inv_free()
        if free <= 0 then store_dbg('pull: inv full -> finish'); store_finish() return end
        r.before_pull = store_count(r.id, { 0 })
        local moved = store_pull(r.id, math.min(8, free))
        store_dbg(('pull: free=%d moved=%d before_pull=%d'):format(free, moved, r.before_pull))
        r.phase = 'pullwait'; r.t = now
    elseif r.phase == 'pullwait' then
        if store_count(r.id, { 0 }) > r.before_pull then r.phase = 'trade'; r.t = now
        elseif now - r.t > 6 then store_dbg('pullwait: TIMEOUT, move_item did not land'); store_finish() end
    end
end

store_progress = nil
function emit_store(active, item, done, total, phase)
    store_progress = { active = active and true or false, item = item or 0, done = done or 0, total = total or 0, phase = phase or '' }
    store_dirty = true
end

function build_storezone()
    local parts = {}
    local bags = store_bags()
    local seen = {}
    local function emit(npc, ids)
        if seen[npc] or not store_find_npc(npc) then return end
        seen[npc] = true
        local items = {}
        for _, id in ipairs(ids) do
            if id and res.items[id] then
                items[#items + 1] = '{"id":' .. id .. ',"n":"' .. esc(res.items[id].en) .. '","c":' .. store_count(id, bags) .. '}'
            end
        end
        local e = STORE_FIXED_NPCS[npc]
        local b = (e and tonumber(e.batch)) or 0
        parts[#parts + 1] = '{"npc":"' .. esc(npc) .. '","batch":' .. b .. ',"items":[' .. table.concat(items, ',') .. ']}'
    end
    for _, cat in ipairs(STORE_CATALOG) do
        local ids = {}
        for _, nm in ipairs(cat.items) do local id = store_item_id(nm); if id then ids[#ids + 1] = id end end
        emit(cat.npc, ids)
    end
    for name, d in pairs(store_discovered) do
        if type(d) == 'table' and type(d.items) == 'table' then emit(name, d.items) end
    end
    if store_debug then store_dbg(('build_storezone zone=%s npcs=%d'):format(tostring((windower.ffxi.get_info() or {}).zone), #parts)) end
    return '{"t":"storezone","npcs":[' .. table.concat(parts, ',') .. ']}\n'
end

-- ===== SP Gobbie Key (Gobbie Mystery Box menu use) ===================================
-- The Mystery Box goblins (the same NPCs that store coffer keys) take SP Gobbie Keys through a
-- MENU dialogue, not a plain trade: trade one key (0x036) -> box menu opens (0x032/0x034) ->
-- pick option 1 (0x05B) -> sub-menu (0x05C) -> confirm option 2 (0x05B) -> the key is consumed
-- and a reward drops into a free slot. Modeled on the Augment feature's menu handling and the
-- FFXIKeys addon. We drive (and swallow) the menu chunks, and confirm each use by the key count
-- dropping, so "Use All" is capped by free inventory space. Runs per character.
gobbie_run = nil

function gobbie_free_slots()
    local inv = windower.ffxi.get_items(0)
    if type(inv) ~= 'table' then return 0 end
    return math.max(0, (inv.max or 0) - (inv.count or 0))
end

function gobbie_key_slot()
    local inv = windower.ffxi.get_items(0)
    if type(inv) ~= 'table' then return nil, 0 end
    local slot, total = nil, 0
    for s = 1, (inv.max or 0) do
        local it = inv[s]
        if type(it) == 'table' and it.id == SPKEY_ID and (it.count or 0) > 0 then
            if not slot then slot = s end
            total = total + it.count
        end
    end
    return slot, total
end

-- The box goblin is the same NPC we store coffer keys to. Prefer the LIVE mob (ground-truth
-- id/index, and it confirms we are standing at it) matched by the store's known id or its name;
-- fall back to the hardcoded store resolution. Sidesteps any hardcoded-id drift between addons.
function gobbie_resolve(npc)
    local sid = select(1, store_find_npc(npc))
    local arr = windower.ffxi.get_mob_array()
    if arr then
        local best_id, best_idx, best_d
        for _, v in pairs(arr) do
            if type(v) == 'table' and v.id and v.id > 0 and v.index and v.distance and (v.id == sid or v.name == npc) then
                local d = math.sqrt(v.distance)
                if d <= 6 and (not best_d or d < best_d) then best_id, best_idx, best_d = v.id, v.index, d end
            end
        end
        if best_id then return best_id, best_idx end
    end
    return store_find_npc(npc)
end

function gobbie_finish()
    local r = gobbie_run
    gobbie_run = nil
    if r then
        alex_chat(207, ('[Alexandria] Used %d SP Gobbie Key%s'):format(r.done or 0, (r.done == 1) and '' or 's'), 'action')
        emit_store(false, SPKEY_ID, r.done or 0, r.want or 0, 'done')
    end
    store_dirty = true
end

function gobbie_begin(npc, want)
    if store_run or gobbie_run then return end
    if not packets_ok then alex_chat(207, '[Alexandria] packets unavailable', 'error') return end
    local nid, nidx = gobbie_resolve(npc)
    if not nid then alex_chat(207, '[Alexandria] ' .. npc .. ' is not in range', 'error') return end
    local _, held = gobbie_key_slot()
    local free = gobbie_free_slots()
    want = math.min(tonumber(want) or 0, held, free)
    if want <= 0 then
        alex_chat(207, (held <= 0) and '[Alexandria] no SP Gobbie Keys held' or '[Alexandria] no free inventory space for box rewards', 'error')
        return
    end
    local zinfo = windower.ffxi.get_info()
    gobbie_lastpkt = {}  -- fresh de-dup state for this run
    gobbie_run = { npc = npc, npc_id = nid, npc_index = nidx, zone = (zinfo and zinfo.zone) or store_last_zone,
        want = want, done = 0, phase = 'trade', menu = nil, queue = {}, t = os.clock(), start = os.clock() }
    alex_chat(207, ('[Alexandria] Using %d SP Gobbie Key%s at %s...'):format(want, (want == 1) and '' or 's', npc), 'action')
    emit_store(true, SPKEY_ID, 0, want, 'using')
end

function gobbie_enqueue(npc, want)
    if gobbie_run then if gobbie_run.npc == npc then gobbie_run.want = gobbie_run.want + (tonumber(want) or 0) end return end
    gobbie_begin(npc, want)
end

function gobbie_trade()
    if not gobbie_run then return end
    local slot = gobbie_key_slot()
    if not slot then gobbie_finish() return end
    pcall(function() packets.inject(packets.new('outgoing', 0x036, {
        ['Target'] = gobbie_run.npc_id, ['Target Index'] = gobbie_run.npc_index,
        ['Item Count 1'] = 1, ['Item Index 1'] = slot, ['Number of Items'] = 1,
    })) end)
    gobbie_run.phase = 'menu'
    gobbie_run.t = os.clock()
end

function gobbie_choice(option, automated)
    if not gobbie_run then return end
    store_dbg(('gobbie choice opt=%d auto=%s menu=%s'):format(option, tostring(automated), tostring(gobbie_run.menu)))
    pcall(function() packets.inject(packets.new('outgoing', 0x05B, {
        ['Target'] = gobbie_run.npc_id, ['Target Index'] = gobbie_run.npc_index,
        ['Option Index'] = option, ['_unknown1'] = 0, ['Automated Message'] = automated and true or false,
        ['Zone'] = gobbie_run.zone, ['Menu ID'] = gobbie_run.menu or 0,
    })) end)
end

-- Mirrors FFXIKeys util/packets.is_duplicate: the game resends these packets, and processing a
-- resend double-advances the dialogue and breaks the run. Key off the first 4 bytes (header + sync)
-- so a retransmit of the same packet is ignored. Reset per run in gobbie_begin.
GOBBIE_DUP = { [0x034] = true, [0x032] = true, [0x05C] = true, [0x052] = true, [0x02A] = true }
gobbie_lastpkt = {}
function gobbie_is_dupe(id, data)
    local b1, b2, b3, b4 = data:byte(1, 4)
    local pid = (b1 or 0) + (b2 or 0) * 0x100 + (b3 or 0) * 0x10000 + (b4 or 0) * 0x1000000
    if gobbie_lastpkt[id] == pid then return true end
    gobbie_lastpkt[id] = pid
    return false
end

-- Runs before the generic NPC-menu handler so we drive (and hide) the box dialogue ourselves.
-- Faithful to the FFXIKeys Use dialogue: 0x036 trade -> box menu 0x034/0x032 (send option 1) ->
-- then EACH sub-menu 0x05C queues one confirm (option 2) that is fired on the NEXT 0x052 ack; the
-- run completes on the first 0x052 with nothing left to confirm. The box's box-open dialogue is
-- multiple confirms deep (option 1, then several option 2s incl. one AFTER the reward), so driving
-- it generically -- not a fixed two steps -- is what lets each use close cleanly and the loop go on.
-- Includes FFXIKeys' packet de-dup so resends don't double-drive it.
function gobbie_incoming(id, data)
    if not gobbie_run then return nil end
    if GOBBIE_DUP[id] and gobbie_is_dupe(id, data) then return nil end
    local r = gobbie_run
    if store_debug and (id == 0x032 or id == 0x034 or id == 0x05C or id == 0x052 or id == 0x02A or id == 0x037) then
        store_dbg(('gobbie in 0x%03X ph=%s q=%d done=%d/%d'):format(id, tostring(r.phase), r.queue and #r.queue or 0, r.done, r.want))
    end
    if id == 0x032 or id == 0x034 then
        local ok, p = pcall(packets.parse, 'incoming', data)
        if ok and p and p['Menu ID'] and p['Menu ID'] ~= 0 then r.menu = p['Menu ID'] end
        if r.phase == 'menu' then
            -- Trade opened the box menu. Fire the first confirm (the box's initial UseMenu -> option
            -- 1, automated) and start driving the dialogue.
            r.queue = {}; r.last_type = 'use'
            r.phase = 'dialogue'; r.t = os.clock()
            gobbie_choice(1, true)
        end
        return true
    elseif id == 0x05C then
        -- Each sub-menu queues one confirm (option 2), fired on the following 0x052. Automated only
        -- for the one that directly follows the initial UseMenu (matches FFXIKeys' ExtraMenu).
        if r.phase == 'dialogue' then
            r.queue[#r.queue + 1] = { option = 2, automated = (r.last_type == 'use') }
            r.last_type = 'simple'; r.t = os.clock()
        end
        return true
    elseif id == 0x052 then
        if r.phase == 'dialogue' then
            if #r.queue > 0 then
                local c = table.remove(r.queue, 1)
                r.t = os.clock()
                gobbie_choice(c.option, c.automated)
            else
                -- Nothing left to confirm: this use is complete. Count it and loop (~0 delay).
                r.done = r.done + 1
                emit_store(true, SPKEY_ID, r.done, r.want, 'using')
                if r.done >= r.want then gobbie_finish() else r.phase = 'trade'; r.t = os.clock() end
            end
        end
        return true  -- block, like FFXIKeys; the client never opened this menu
    elseif id == 0x037 then
        return true
    end
    return nil
end

function gobbie_tick(now)
    local r = gobbie_run
    if not r then return end
    if now - r.start > 300 then gobbie_finish() return end
    if r.phase == 'trade' then
        local slot, held = gobbie_key_slot()
        if r.done >= r.want or not slot or held <= 0 or gobbie_free_slots() <= 0 then gobbie_finish() return end
        gobbie_trade()  -- sends 0x036 and moves to 'menu'
    elseif r.phase == 'menu' or r.phase == 'dialogue' then
        -- The dialogue is packet-driven (gobbie_incoming). This only guards against a stall.
        if now - r.t > 8 then store_dbg('gobbie: ' .. r.phase .. ' timeout'); gobbie_finish() end
    end
end

function build_store()
    local p = store_progress
    if not p then return '{"t":"store","active":false}\n' end
    return ('{"t":"store","active":%s,"item":%d,"done":%d,"total":%d,"phase":"%s"}\n'):format(
        p.active and 'true' or 'false', p.item, p.done, p.total, esc(p.phase))
end

function shop_autosell_run()
    if not packets_ok then return end
    -- Stand down while the player is hands-on the sell menu. FFXI's 0x085 confirm carries no
    -- item; it sells whatever the last 0x084 appraise selected, and that slot is shared with
    -- the client. Injecting a sell now could confirm the item they only meant to price-check.
    if os.clock() < shop_manual_until then return end
    local inv = windower.ffxi.get_items(0)
    if not inv then return end
    local now = os.clock()
    for s = 1, (inv.max or 80) do
        local it = inv[s]
        if type(it) == 'table' and it.id and it.id ~= 0 and shop_sell_list[it.id] and it.status == 0 and not shop_no_sale(it.id) then
            -- Guard against re-sending a sell for a slot whose previous sell the
            -- server hasn't confirmed yet (inventory still shows the item).
            if not shop_sold[s] or (now - shop_sold[s]) > 3 then
                shop_do_sell(it.id, s, it.count or 1)
                shop_sold[s] = now
            end
        end
    end
end

function shop_handle_incoming(data)
    local n = #data
    if n < 20 then return end
    local offset = rd_u16(data, 5)
    local found = {}
    local pos, i = 9, 0
    while pos + 11 <= n do
        local itemno = rd_u16(data, pos + 4)
        if itemno and itemno ~= 0 then
            local r = res.items[itemno]
            local idx = offset + i
            found[idx] = { idx = idx, id = itemno, price = rd_u32(data, pos), name = (r and r.en) or ('Item ' .. itemno), skill = rd_u16(data, pos + 8), rank = math.floor(rd_u16(data, pos + 10) / 100) }
            queue_icon(itemno)
        end
        pos = pos + 12
        i = i + 1
    end
    if next(found) == nil then return end
    if offset == 0 then shop.items = {}; shop_opened_t = os.clock(); shop_session = true; shop_sold = {} end
    for idx, it in pairs(found) do shop.items[idx] = it end
    shop_dirty = true
    if npc_last_select and (os.clock() - npc_last_select.t) < 5 then
        local mob = npc_last_select.target and windower.ffxi.get_mob_by_id(npc_last_select.target)
        local nname = (mob and mob.name) or (npc_near and npc_near.name)
        if nname then
            npc_learn = { npc = nname, option = npc_last_select.option }
            npc_learn_dirty = true
        end
    end
    if shop_autosell or (sell_anywhere and in_town()) then shop_autosell_run() end
end

function build_shop()
    local list = {}
    for _, it in pairs(shop.items) do list[#list + 1] = it end
    table.sort(list, function(a, b) return a.idx < b.idx end)
    local parts = {}
    for _, it in ipairs(list) do
        local extra = (it.rank and it.rank > 0) and (',"rank":' .. it.rank .. ',"skill":' .. (it.skill or 0)) or ''
        parts[#parts + 1] = '{"idx":' .. it.idx .. ',"id":' .. it.id .. ',"price":' .. it.price .. ',"n":"' .. esc(it.name) .. '"' .. extra .. '}'
    end
    return '{"t":"shop","items":[' .. table.concat(parts, ',') .. ']}\n'
end

local function npc_send_select(m, option)
    local p = string.char(0x5B, 0x0A, 0, 0) .. le4(m.id) .. le2(option) .. le2(0) .. le2(m.index) .. string.char(0, 0) .. le2(m.zone) .. le2(m.menu)
    pcall(windower.packets.inject_outgoing, 0x5B, p)
end

local function npc_poke(id, index)
    local p = string.char(0x1A, 0x0E, 0, 0) .. le4(id) .. le2(index) .. le2(0) .. le2(0) .. le2(0) .. string.rep('\0', 12)
    pcall(windower.packets.inject_outgoing, 0x1A, p)
end

function npc_scan(now)
    if now - npc_near_t < 0.5 then return end
    npc_near_t = now
    local arr = windower.ffxi.get_mob_array()
    local me = windower.ffxi.get_mob_by_target('me')
    if not arr or not me or not me.x then return end
    local watching = next(npc_watch) ~= nil
    local pn = false
    local sn, un, cn = false, false, false
    local nn = false
    local eph = false
    local fn = {}
    local wpn = {}
    local best, bestd = nil, nil
    local pvbest, pvbestd = nil, nil
    for _, v in pairs(arr) do
        if v and v.name and v.x then
            local dx, dy = v.x - me.x, v.y - me.y
            local d = dx * dx + dy * dy
            if v.name == 'Porter Moogle' and d < 36 then pn = true end
            if SPARKS_NPCS[v.name] and d < 36 then sn = true end
            if UNITY_NPCS[v.name] and d < 36 then un = true end
            if v.name == CURIO_NAME and d < 36 then cn = true end
            if PVENDOR_SHOPS[v.name] and d < 36 and (not pvbestd or d < pvbestd) then pvbest = v; pvbestd = d end
            if v.name == 'Nomad Moogle' and d < 36 then nn = true end
            if v.name == 'Ephemeral Moogle' and d < 36 then eph = true end
            if STORE_FIXED_NPCS[v.name] and d < 36 then fn[#fn + 1] = v.name end
            if STORE_NEAREST_NAMES[v.name] and d < 36 then wpn[#wpn + 1] = v.name end
            if watching and npc_watch[v.name] and d < 144 and (not bestd or d < bestd) then best = v; bestd = d end
        end
    end
    if pn ~= porter_near then porter_near = pn; porter_near_dirty = true end
    if sn ~= sparks_near or un ~= unity_near or cn ~= curio_near then sparks_near = sn; unity_near = un; curio_near = cn; vendor_near_dirty = true end
    if nn ~= nomad_near then nomad_near = nn end
    if eph ~= store_eph_near then store_eph_near = eph; store_dirty = true end
    table.sort(fn)
    local fkey = table.concat(fn, '|')
    if fkey ~= fixed_near_key then fixed_near_key = fkey; fixed_near = fn; fixed_near_dirty = true; store_dirty = true end
    -- Proximity-based storage NPCs (Waypoints) are not in STORE_FIXED_NPCS, so track them
    -- separately: walking into/out of range must refresh the store panel, since build_storezone
    -- only re-runs when store_dirty flips (it never re-evaluated on movement before this).
    table.sort(wpn)
    local wpkey = table.concat(wpn, '|')
    if wpkey ~= store_wp_near_key then store_wp_near_key = wpkey; store_dirty = true end
    if best then
        npc_near_seen = now
        if not npc_near or npc_near.id ~= best.id then
            npc_near = { name = best.name, id = best.id, index = best.index, zone = (windower.ffxi.get_info() or {}).zone or 0 }
            npc_near_dirty = true
        end
    elseif npc_near and (now - npc_near_seen) > 2 then
        npc_near = nil
        npc_near_dirty = true
    end
    if pvbest then
        if not pvendor_near or pvendor_near.id ~= pvbest.id then
            pvendor_near = { name = pvbest.name, id = pvbest.id, index = pvbest.index }
            pvendor_near_dirty = true
        end
    elseif pvendor_near then
        pvendor_near = nil
        pvendor_near_dirty = true
    end
end

function npc_menu_handle(data)
    local ok, p = pcall(packets.parse, 'incoming', data)
    if not ok or not p or not p['Menu ID'] then return false end
    local nid, nidx = p['NPC'], p['NPC Index']
    if not nid or not nidx then return false end
    local zone = p['Zone'] or (windower.ffxi.get_info() or {}).zone or 0
    npc_menu = { id = nid, index = nidx, zone = zone, menu = p['Menu ID'] }
    if store_close_until > 0 and os.clock() < store_close_until then
        store_close_until = 0
        store_dbg(('store: block menu %d + inject close'):format(p['Menu ID'] or -1))
        store_menu_close()
        return true
    end
    if npc_pending and (os.clock() - npc_pending.t) < 4 and npc_pending.id == nid then
        local opt = npc_pending.option
        npc_pending = nil
        local m = npc_menu
        coroutine.schedule(function() npc_send_select(m, opt) end, 0.1)
    end
    if npc_driving and npc_driving.id == nid and (os.clock() - npc_driving.t) < 6 then
        return true
    end
    return false
end

function npc_menu_select(option)
    if not packets_ok or not npc_near then return false end
    local target = npc_near
    local pend = { option = option, id = target.id, t = os.clock() }
    npc_pending = pend
    npc_driving = { id = target.id, t = os.clock() }
    npc_poke(target.id, target.index)
    coroutine.schedule(function()
        if npc_pending == pend then
            npc_pending = nil
            if npc_menu and npc_menu.id == target.id then npc_send_select(npc_menu, option) end
        end
    end, 1.2)
    return true
end

function build_npcnear()
    if not npc_near then return '{"t":"npcnear","name":null}\n' end
    return '{"t":"npcnear","name":"' .. esc(npc_near.name) .. '","id":' .. npc_near.id .. ',"index":' .. npc_near.index .. '}\n'
end

function build_fixednear()
    local parts = {}
    for _, n in ipairs(fixed_near) do parts[#parts + 1] = '"' .. esc(n) .. '"' end
    return '{"t":"fixednear","names":[' .. table.concat(parts, ',') .. ']}\n'
end

function resupply_needed()
    local needed, any = {}, false
    for id, min in pairs(resupply_min) do
        local n = min - resupply_count(id)
        if n > 0 then needed[id] = n; any = true end
    end
    return any and needed or nil
end

function item_flag(id, name, bit)
    local r = res.items[id]
    if not r then return false end
    local f = r.flags
    if type(f) == 'table' then return f[name] == true end
    if type(f) == 'number' then return (math.floor(f / bit) % 2) == 1 end
    return false
end

function resupply_is_rare(id)
    return item_flag(id, 'Rare', 32768)
end

-- Bags a character carries an item in (inventory + satchel/sack/case + wardrobes). Counted
-- for every resupply stock check, not just inventory: surplus a character keeps in its
-- Sack/Satchel/etc. (e.g. via Organize) is real stock, so Curio must not re-buy it. Deep
-- storage (Safe/Storage/Locker) is excluded on purpose since it isn't field-reachable.
RESUPPLY_CARRY_BAGS = { 0, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16 }

function resupply_count(id)
    local n = 0
    for _, bag in ipairs(RESUPPLY_CARRY_BAGS) do
        local inv = windower.ffxi.get_items(bag)
        if inv then
            for s = 1, (inv.max or 80) do
                local it = inv[s]
                if type(it) == 'table' and it.id == id then n = n + (it.count or 0) end
            end
        end
    end
    return n
end

rs_debug = false
function rs_log(m) if rs_debug then windower.add_to_chat(200, '[rs] ' .. m) end end
function rs_item_name(id) local r = res.items[id]; return (r and r.en) or ('item ' .. tostring(id)) end

-- Live restock progress shipped to the app so the user can follow each character.
resupply_progress = nil
resupply_dirty = false
function emit_resupply(active, item, have, target, phase)
    resupply_progress = { active = active and true or false, item = item or 0, have = have or 0, target = target or 0, phase = phase or '' }
    resupply_dirty = true
end
function build_resupply()
    local p = resupply_progress
    if not p then return nil end
    return '{"t":"resupply","active":' .. (p.active and 'true' or 'false')
        .. ',"item":' .. p.item .. ',"have":' .. p.have .. ',"target":' .. p.target
        .. ',"phase":"' .. p.phase .. '"}\n'
end

-- Send a 0x05B menu packet to the moogle. Category selects: option N, _unknown1 = 0.
-- Close a sub-shop back to the category menu: option 0, _unknown1 = 0x4000 (this is
-- what the retail client / Silmaril's Reflect sends). Leave the category menu entirely
-- ("Nothing for now"): a plain option-0 select, _unknown1 = 0.
function resupply_sel(opt, unk1)
    if not packets_ok or not npc_menu then return end
    local m = npc_menu
    local p = string.char(0x5B, 0x0A, 0, 0) .. le4(m.id) .. le2(opt) .. le2(unk1 or 0)
        .. le2(m.index) .. string.char(0, 0) .. le2(m.zone) .. le2(m.menu)
    pcall(windower.packets.inject_outgoing, 0x5B, p)
end

function resupply_finish(now)
    local r = resupply_run
    local n = r and r.bought_n or 0
    local curio_id = r and r.npc_id
    local npc_id = (npc_near and npc_near.id) or curio_id
    -- Partial failure: a category never opened (multibox contention) AND we're still short. Retry soon
    -- (bounded) instead of the 30s success cooldown, and tell the desktop this character did NOT finish.
    local partial = r and (r.failed_cats or 0) > 0 and resupply_needed()
    local retry = false
    if partial then
        local fails = (resupply_fails[npc_id] or 0) + 1
        resupply_fails[npc_id] = fails
        retry = fails < 3
    else
        resupply_fails[npc_id] = nil
    end
    resupply_cd_npc = npc_id
    resupply_cd = now + (retry and 5 or 30)
    resupply_run = nil
    -- 'retry' = re-runs itself shortly; 'failed' = backed off but still short. Both are "unfinished" to the
    -- desktop; a clean restock emits 'done'. No user-facing nag -- Alexandria corrects itself.
    emit_resupply(false, 0, 0, 0, partial and (retry and 'retry' or 'failed') or 'done')
    if not partial then
        if n > 0 then
            alex_chat(207, ('[Alexandria] Curio Moogle restock complete. Restocked %d item%s.'):format(n, n == 1 and '' or 's'), 'action')
        else
            alex_chat(207, '[Alexandria] Curio Moogle restock complete.', 'action')
        end
    end
    if curio_id then
        for _, t in ipairs({ 1.2, 2.5, 4.0 }) do
            coroutine.schedule(function() if not resupply_run and npc_menu and npc_menu.id == curio_id then resupply_sel(0, 0) end end, t)
        end
    end
end

function resupply_next_category(r)
    for _, opt in ipairs(resupply_opts) do
        if not r.cat_done[opt] then return opt end
    end
    return nil
end

function resupply_pick(r)
    for _, it in pairs(shop.items) do
        local target = resupply_min[it.id]
        if target and not r.attempted[it.id] and resupply_count(it.id) < target then
            return { id = it.id, idx = it.idx, target = target }
        end
    end
    return nil
end

-- At the category menu: open the next category that still needs stock, or leave.
-- Poke the captured moogle and arm the auto-select for a category, the same way the scan
-- does (npc_menu_handle fires the option select when the menu arrives). Uses the moogle
-- id/index captured at start so it keeps working even if the live npc_near scan flickers.
function resupply_open_cat(r, opt)
    if not packets_ok then return end
    r.cur_opt = opt
    r.drained = false
    r.state = 'shop'
    r.t = os.clock()
    npc_pending = { option = opt, id = r.npc_id, t = os.clock() }
    npc_driving = { id = r.npc_id, t = os.clock() }
    npc_poke(r.npc_id, r.npc_index)
end

function resupply_begin(r)
    if resupply_run ~= r then return end
    local opt = resupply_next_category(r)
    if not opt then resupply_finish(os.clock()); return end
    rs_log('begin: open category opt=' .. opt)
    resupply_open_cat(r, opt)
end

-- True if any configured item is still below its target and wasn't already given up on
-- (e.g. a Rare you can't hold). Used to re-sweep so streaming shop lists don't drop items.
function resupply_still_needed(r)
    for id, target in pairs(resupply_min) do
        if r.seen and r.seen[id] and not r.attempted[id] and resupply_count(id) < target then return true end
    end
    return false
end

-- Move to the next category like the scan: poke + auto-select. No close in between.
function resupply_advance(r)
    if resupply_run ~= r then return end
    local opt = resupply_next_category(r)
    if not opt then
        -- All categories walked. If something's still short (a slow shop list may have
        -- dropped it), sweep the categories again before leaving.
        if resupply_still_needed(r) and (r.pass or 0) < 2 then
            r.pass = (r.pass or 0) + 1
            r.cat_done = {}
            rs_log('re-sweep pass ' .. r.pass)
            opt = resupply_next_category(r)
        else
            rs_log('no more categories -> leave')
            resupply_sel(0, 0)            -- "Nothing for now" -> release from the moogle
            resupply_finish(os.clock())
            return
        end
    end
    rs_log('next category opt=' .. opt)
    resupply_open_cat(r, opt)
end

-- In the open shop: buy the next item that's short, or move on to the next category.
function resupply_buy_step(r)
    if resupply_run ~= r or r.state ~= 'buy' then return end
    r.seen = r.seen or {}
    for _, it in pairs(shop.items) do
        if type(it) == 'table' and it.id and resupply_min[it.id] then r.seen[it.id] = true end
    end
    local b = resupply_pick(r)
    if not b then
        -- The shop list streams in over several 0x03C packets; before declaring the
        -- category done, give it one grace re-check so late-arriving items aren't missed.
        if not r.drained then
            r.drained = true
            r.state = 'draining'
            r.t = os.clock()
            rs_log('no item yet; grace re-check (shop may still be loading)')
            coroutine.schedule(function() if resupply_run == r and r.state == 'draining' then r.state = 'buy'; resupply_buy_step(r) end end, 1.2)
            return
        end
        rs_log('category opt=' .. tostring(r.cur_opt) .. ' done')
        r.cat_done[r.cur_opt] = true
        resupply_advance(r)
        return
    end
    r.drained = false
    r.buy = { id = b.id, idx = b.idx, target = b.target, before = resupply_count(b.id) }
    r.state = 'buyack'
    r.t = os.clock()
    local r_item = res.items[b.id]
    local stack = (r_item and r_item.stack) or 1
    local qty = math.min(b.target - r.buy.before, stack)
    rs_log(('buy id=%d slot=%d x%d (have %d/%d)'):format(b.id, b.idx, qty, r.buy.before, b.target))
    emit_resupply(true, b.id, r.buy.before, b.target, 'buying')
    shop_buy(b.idx, qty)
end

-- After a buy: confirm it landed in inventory before doing anything else. Driven by the
-- server's buy response (0x03F) and inventory updates; the tick watchdog covers a buy
-- that never delivers (no gil / no room) so it gets skipped instead of looping.
function resupply_buy_check(r)
    if resupply_run ~= r or r.state ~= 'buyack' then return end
    local b = r.buy
    local have = resupply_count(b.id)
    if have >= b.target or have > b.before then
        rs_log(('confirmed id=%d now %d/%d'):format(b.id, have, b.target))
        r.counted = r.counted or {}
        if not r.counted[b.id] then r.counted[b.id] = true; r.bought_n = (r.bought_n or 0) + 1 end
        alex_chat(207, ('[Alexandria] Restocked %s (%d/%d)'):format(rs_item_name(b.id), have, b.target), 'progress')
        emit_resupply(true, b.id, have, b.target, 'buying')
        r.state = 'paced'               -- it arrived; small gap before the next buy
        r.t = os.clock()
        coroutine.schedule(function() if resupply_run == r and r.state == 'paced' then r.state = 'buy'; resupply_buy_step(r) end end, 0.4)
    elseif os.clock() - r.t > 3 then
        rs_log('buy id=' .. b.id .. ' not confirmed; skip')
        r.attempted[b.id] = true        -- nothing arrived (no gil / no room / already own a Rare); skip
        r.state = 'buy'
        resupply_buy_step(r)
    end
end

-- The category open is handled by npc_menu_select; here we only react to the shop list
-- (0x03C) and the buy response (0x03F) / inventory updates.
function resupply_incoming(id)
    local r = resupply_run
    if not r then return end
    if id == 0x03C then
        rs_log('shop opened (0x03C) state=' .. r.state)
        if r.state == 'shop' then
            r.state = 'buy'
            r.retries = 0
            r.t = os.clock()
            coroutine.schedule(function() resupply_buy_step(r) end, 1.0)
        end
    elseif id == 0x03F then
        if r.state == 'buyack' then resupply_buy_check(r) end
    end
end

-- ===== Proximity Buy/Sell vendors =====================================================
-- Same packet engine as Curio (poke -> shop list -> 0x083 buy), minus the category menu.
-- npc_scan sets pvendor_near to the nearest cataloged vendor; a run pokes it, waits for its
-- 0x03C shop list, then buys each configured item to target -- resupply_count() supplies the
-- owned-stock count (so organized surplus reads as stock) and shop_buy() caps to the stack.
function emit_pvendor(active, item, have, target, phase)
    pvendor_progress = { active = active and true or false, item = item or 0, have = have or 0, target = target or 0, phase = phase or '' }
    pvendor_dirty = true
end

function build_pvendor()
    local p = pvendor_progress
    if not p then return nil end
    return '{"t":"pvendor","active":' .. (p.active and 'true' or 'false')
        .. ',"item":' .. p.item .. ',"have":' .. p.have .. ',"target":' .. p.target
        .. ',"phase":"' .. esc(p.phase) .. '"}\n'
end

function build_pvendornear()
    if not pvendor_near then return '{"t":"pvendornear","name":null}\n' end
    return '{"t":"pvendornear","name":"' .. esc(pvendor_near.name) .. '"}\n'
end

function pvendor_item_name(id)
    return (res.items[id] and res.items[id].en) or ('Item ' .. id)
end

-- Does this vendor sell anything still below its configured target?
function pvendor_needed_at(name)
    local ids = PVENDOR_SHOPS[name]
    if not ids then return false end
    for _, id in ipairs(ids) do
        local target = pvendor_min[id]
        if target and target > 0 and resupply_count(id) < target then return true end
    end
    return false
end

-- Has this vendor's shop list (0x03C) arrived with one of its items yet?
function pvendor_shop_ready(r)
    for _, it in pairs(shop.items) do
        if type(it) == 'table' and it.id then
            for _, id in ipairs(r.ids) do if it.id == id then return true end end
        end
    end
    return false
end

-- Next shop entry for a configured item that's still short and not yet given up on.
function pvendor_pick(r)
    for _, it in pairs(shop.items) do
        if type(it) == 'table' and it.id and pvendor_min[it.id] and not r.attempted[it.id] then
            if resupply_count(it.id) < pvendor_min[it.id] then
                return { id = it.id, idx = it.idx, target = pvendor_min[it.id] }
            end
        end
    end
    return nil
end

-- mode: nil = success, 'retry' = shop never opened but worth trying again soon (short cooldown so a
-- multibox contention miss self-heals), 'giveup' = failed and backed off for the full cooldown. A failed
-- finish emits phase 'failed' (NOT 'done') so the desktop never counts it as a completed character, and the
-- caller owns the failure chat line.
function pvendor_finish(now, mode)
    local r = pvendor_run
    local failed = (mode == 'retry' or mode == 'giveup')
    pvendor_cd_npc = (r and r.npc_id) or (pvendor_near and pvendor_near.id) or nil
    pvendor_cd = now + (mode == 'retry' and 5 or 30)
    pvendor_run = nil
    npc_driving = nil
    store_menu_close()            -- release the vendor / close the shop window
    -- 'retry' = will re-run itself shortly (not finished, but not a hard failure); 'giveup' = backed off but
    -- still short. Both are "unfinished" to the desktop; only a clean run emits 'done'.
    emit_pvendor(false, 0, 0, 0, (mode == 'giveup' and 'failed') or (mode == 'retry' and 'retry') or 'done')
    if failed then return end
    local n = r and r.bought_n or 0
    local who = (r and r.name) or 'Vendor'
    if n > 0 then
        alex_chat(207, ('[Alexandria] %s restock complete. Bought %d time%s.'):format(who, n, n == 1 and '' or 's'), 'action')
    else
        alex_chat(207, ('[Alexandria] %s restock complete.'):format(who), 'action')
    end
end

-- Buy the next short item, then re-check after it settles. Stop an item when it reaches
-- target OR when a buy makes no progress (sold out / out of gil), so single-buy items with
-- big targets loop but a dead buy never spins forever.
function pvendor_buy_step(r, now)
    if pvendor_run ~= r or r.state ~= 'buy' then return end
    local b = pvendor_pick(r)
    if not b then pvendor_finish(now or os.clock()); return end
    local have = resupply_count(b.id)
    emit_pvendor(true, b.id, have, b.target, 'buy')
    shop_buy(b.idx, b.target - have)        -- shop_buy caps qty to the item's stack per packet
    r.bought_n = r.bought_n + 1
    r.t = os.clock()
    coroutine.schedule(function()
        if pvendor_run ~= r then return end
        local nowhave = resupply_count(b.id)
        if nowhave >= b.target then
            r.attempted[b.id] = true
        elseif nowhave <= have then
            r.attempted[b.id] = true
            alex_chat(207, ('[Alexandria] Could not buy enough %s (%d/%d)'):format(pvendor_item_name(b.id), nowhave, b.target), 'error')
        end
        r.state = 'buy'; r.t = os.clock()
        pvendor_buy_step(r, os.clock())
    end, 1.2)
end

function pvendor_tick(now)
    if not pvendor_run then
        if not pvendor_on or not pvendor_near then return end
        local ids = PVENDOR_SHOPS[pvendor_near.name]
        if not ids then return end
        if pvendor_cd_npc == pvendor_near.id and now < pvendor_cd then return end
        if not pvendor_needed_at(pvendor_near.name) then pvendor_cd_npc = pvendor_near.id; pvendor_cd = now + 30; return end
        pvendor_run = { state = 'open', start = now, t = now, npc_id = pvendor_near.id, npc_index = pvendor_near.index, name = pvendor_near.name, ids = ids, attempted = {}, bought_n = 0 }
        shop.items = {}                         -- drop any stale list so we detect THIS shop's
        npc_driving = { id = pvendor_run.npc_id, t = now }
        alex_chat(207, '[Alexandria] Buying from ' .. pvendor_near.name .. '...', 'action')
        emit_pvendor(true, 0, 0, 0, 'start')
        npc_poke(pvendor_run.npc_id, pvendor_run.npc_index)
        return
    end

    local r = pvendor_run
    if now - r.start > 45 then pvendor_finish(now, 'giveup'); return end

    if r.state == 'open' then
        if pvendor_shop_ready(r) then
            r.state = 'buy'; r.t = now
            pvendor_fails[r.npc_id] = nil       -- opened fine: clear the fail streak for this vendor
            pvendor_buy_step(r, now)
        elseif now - r.t > 3 then
            -- Shop hasn't opened. Under multibox load the NPC is busy and the first interaction (or its
            -- 0x03C reply) can be dropped, so we (a) answer a gating Buy/Sell menu if one popped, then
            -- (b) RE-POKE a few times before giving up, rather than failing after a single attempt.
            if npc_menu and npc_menu.id == r.npc_id and not r.nudged then
                r.nudged = true; r.t = now
                npc_send_select(npc_menu, 0)
            elseif (r.pokes or 1) < 4 then
                r.pokes = (r.pokes or 1) + 1; r.nudged = false; r.t = now
                store_menu_close()              -- drop any stuck talk menu first
                local rr, id, idx = r, r.npc_id, r.npc_index
                coroutine.schedule(function() if pvendor_run == rr then npc_poke(id, idx) end end, 0.3)
            else
                local fails = (pvendor_fails[r.npc_id] or 0) + 1
                pvendor_fails[r.npc_id] = fails
                -- No "try again" nag: Alexandria retries itself on a short cooldown for a few rounds so a
                -- contention miss self-heals, then backs off the full cooldown (and keeps trying after that).
                -- The desktop batch summary is the only place a still-unfinished character is surfaced.
                pvendor_finish(now, fails < 3 and 'retry' or 'giveup')
            end
        end
    elseif r.state == 'buy' and now - r.t > 4 then
        pvendor_buy_step(r, now)                -- watchdog: the buy coroutine never fired
    end
end
-- ===== end proximity vendors ==========================================================

function resupply_tick(now)
    if not resupply_run then
        if not resupply_on or not npc_near or npc_near.name ~= CURIO_NAME or #resupply_opts == 0 then return end
        if resupply_cd_npc == npc_near.id and now < resupply_cd then return end
        if not resupply_needed() then resupply_cd_npc = npc_near.id; resupply_cd = now + 30; return end
        resupply_run = { state = 'shop', start = now, t = now, attempted = {}, cat_done = {}, bought_n = 0, npc_id = npc_near.id, npc_index = npc_near.index }
        rs_log('start, opts=' .. table.concat(resupply_opts, ','))
        alex_chat(207, '[Alexandria] Starting Curio Moogle supply restock...', 'action')
        emit_resupply(true, 0, 0, 0, 'start')
        resupply_begin(resupply_run)            -- proven open (poke + auto-select)
        return
    end

    local r = resupply_run
    -- Deliberately do NOT clear the run when npc_near flickers off mid-transaction -- the
    -- captured npc_id keeps driving it; only the overall timeout / zone ends it.
    if now - r.start > 60 then rs_log('overall timeout; leave'); resupply_sel(0, 0); resupply_finish(now); return end

    -- Watchdogs: only act if a state has clearly stalled (the expected packet never came).
    if r.state == 'shop' and now - r.t > 4 then
        resupply_sel(0, 0)
        r.t = os.clock()
        if (r.retries or 0) < 3 then
            r.retries = (r.retries or 0) + 1
            rs_log('shop stalled opt=' .. tostring(r.cur_opt) .. '; close+retry ' .. r.retries)
            coroutine.schedule(function() if resupply_run == r then resupply_open_cat(r, r.cur_opt) end end, 1.2)
        else
            rs_log('shop never opened opt=' .. tostring(r.cur_opt) .. '; give up')
            r.cat_done[r.cur_opt] = true
            r.failed_cats = (r.failed_cats or 0) + 1   -- category never opened -> partial restock
            r.retries = 0
            coroutine.schedule(function() if resupply_run == r then resupply_advance(r) end end, 1.2)
        end
    elseif r.state == 'buy' and now - r.t > 4 then
        resupply_buy_step(r)                    -- buy coroutine never fired
    elseif r.state == 'draining' and now - r.t > 3 then
        r.state = 'buy'; resupply_buy_step(r)   -- grace coroutine never fired
    elseif r.state == 'paced' and now - r.t > 2 then
        r.state = 'buy'; resupply_buy_step(r)   -- pacing coroutine never fired
    elseif r.state == 'buyack' and now - r.t > 5 then
        resupply_buy_check(r)                   -- buy never confirmed; skip and continue
    end
end

-- Close whatever NPC menu/shop is open (best-effort), so an interrupted scan or
-- event never leaves the character stuck talking to the moogle.
function npc_menu_close()
    if packets_ok and npc_menu then
        local m = npc_menu
        local p = string.char(0x5B, 0x0A, 0, 0) .. le4(m.id) .. le2(0) .. le2(0) .. le2(m.index) .. string.char(0, 0) .. le2(m.zone) .. le2(m.menu)
        pcall(windower.packets.inject_outgoing, 0x5B, p)
    end
end

-- Curio catalog scan: walk every category menu of the Curio Vendor Moogle, capture
-- each sub-shop's items + prices (tagged with the menu option that opened it), and
-- ship the whole catalog to the app so Resupply can pick from real stock.
curio_scan = nil

function curio_scan_start()
    if curio_scan then return end
    if not packets_ok then alex_chat(207, '[Alexandria] packets unavailable', 'error') return end
    if not npc_near or npc_near.name ~= CURIO_NAME then alex_chat(207, '[Alexandria] Curio: stand at the Curio Vendor Moogle first', 'error') return end
    curio_scan = { opt = -1, max = 15, phase = 'next', t = 0, shop_t0 = 0, await_t = 0, seen = {}, items = {}, cats = 0 }
    queue_send('{"t":"curioscan","active":true,"opt":0,"max":15,"count":0}\n')
end

local function curio_scan_progress()
    local s = curio_scan
    queue_send('{"t":"curioscan","active":true,"opt":' .. s.opt .. ',"max":' .. s.max .. ',"count":' .. #s.items .. '}\n')
end

local function curio_scan_finish()
    local s = curio_scan
    local parts = {}
    for _, it in ipairs(s.items) do
        parts[#parts + 1] = '{"id":' .. it.id .. ',"price":' .. it.price .. ',"opt":' .. it.opt
            .. ',"stack":' .. (it.stack or 1) .. ',"rare":' .. (it.rare and 'true' or 'false')
            .. ',"ex":' .. (it.ex and 'true' or 'false') .. ',"n":"' .. esc(it.name) .. '"}'
    end
    local arr = '[' .. table.concat(parts, ',') .. ']'
    pcall(function()
        local f = io.open(windower.addon_path .. 'curio_catalog.json', 'w')
        if f then f:write(arr); f:close() end
    end)
    queue_send('{"t":"curiocatalog","items":' .. arr .. '}\n')
    queue_send('{"t":"curioscan","active":false,"opt":' .. s.opt .. ',"max":' .. s.max .. ',"count":' .. #s.items .. '}\n')
    alex_chat(207, '[Alexandria] Curio scan complete: ' .. #s.items .. ' items in ' .. s.cats .. ' categories', 'action')
    curio_scan = nil
    npc_menu_close()
end

function curio_scan_tick(now)
    local s = curio_scan
    if not s then return end
    if not npc_near or npc_near.name ~= CURIO_NAME then
        alex_chat(207, '[Alexandria] Curio scan cancelled (moved away)', 'error')
        queue_send('{"t":"curioscan","active":false,"opt":' .. s.opt .. ',"max":' .. s.max .. ',"count":' .. #s.items .. '}\n')
        curio_scan = nil
        npc_menu_close()
        return
    end
    if now - s.t < 0.5 then return end
    s.t = now
    if s.phase == 'next' then
        s.opt = s.opt + 1
        if s.opt > s.max then curio_scan_finish(); return end
        s.phase = 'engage'
    elseif s.phase == 'engage' then
        s.shop_t0 = now
        s.await_t = now
        npc_menu_select(s.opt)
        s.phase = 'await'
    elseif s.phase == 'await' then
        if shop_opened_t > s.shop_t0 then
            s.phase = 'capture'
            s.cap_start = now
            s.last_grow = now
            s.last_n = -1
            s.cat_new = 0
        elseif now - s.await_t > 4 then
            s.phase = 'next'
        end
    elseif s.phase == 'capture' then
        -- A big shop streams its items over several 0x03C packets (each carries up to
        -- ~41, indexed by ShopItemOffsetIndex) and there's no end-of-list signal. Keep
        -- merging and only leave once the list has been quiet for a sustained window, so
        -- late pages (Bullet/Shuriken Pouches, extra Food) aren't dropped.
        for _, it in pairs(shop.items) do
            if it.id and it.id ~= 0 and not s.seen[it.id] then
                s.seen[it.id] = true
                local r = res.items[it.id]
                s.items[#s.items + 1] = {
                    id = it.id, name = it.name, price = it.price, opt = s.opt,
                    stack = (r and r.stack) or 1,
                    rare = item_flag(it.id, 'Rare', 32768),
                    ex = item_flag(it.id, 'Exclusive', 16384),
                }
                s.cat_new = s.cat_new + 1
            end
        end
        local n = 0
        for _ in pairs(shop.items) do n = n + 1 end
        if n ~= s.last_n then s.last_n = n; s.last_grow = now; curio_scan_progress() end
        if now - s.last_grow >= 3 or now - s.cap_start >= 15 then
            if s.cat_new > 0 then s.cats = s.cats + 1; curio_scan_progress() end
            s.phase = 'next'
        end
    end
end

-- Currency shops: buy with Sparks of Eminence (Records-of-Eminence vendor) or
-- Unity Accolades (Unity concierge). Two different menu mechanics.
SPARKS_NPCS = { ['Eternal Flame'] = true, ['Rolandienne'] = true, ['Isakoth'] = true, ['Fhelm Jobeizat'] = true }
UNITY_NPCS = { ['Igsli'] = true, ['Urbiolaine'] = true, ['Teldro-Kesdrodo'] = true, ['Yonolala'] = true, ['Nunaarl Bthtrogg'] = true }

SPARKS_OPT = {
    [12385] = { str = string.char(9, 0, 0x29, 0), cost = 2755 }, -- Acheron's Shield
    [12302] = { str = string.char(8, 0, 0x24, 0), cost = 473 },  -- Darksteel Buckler
    [16834] = { str = string.char(4, 0, 0xE, 0), cost = 60 },    -- Brass Spear
    [17081] = { str = string.char(4, 0, 0x15, 0), cost = 60 },   -- Brass Rod
    [16407] = { str = string.char(4, 0, 0, 0), cost = 60 },      -- Brass Baghnakhs
    [12680] = { str = string.char(5, 0, 0x1F, 0), cost = 141 },  -- Chain Mittens
    [12936] = { str = string.char(5, 0, 0x21, 0), cost = 129 },  -- Greaves
    [12299] = { str = string.char(3, 0, 0x3F, 0), cost = 50 },   -- Aspis
    [16704] = { str = string.char(3, 0, 0xC, 0), cost = 50 },    -- Butterfly Axe
    [16390] = { str = string.char(3, 0, 0x1, 0), cost = 50 },    -- Bronze Knuckles
    [16900] = { str = string.char(3, 0, 0x12, 0), cost = 50 },   -- Wakizashi
    [16960] = { str = string.char(4, 0, 0x12, 0), cost = 68 },   -- Uchigatana
    [16419] = { str = string.char(7, 0, 2, 0), cost = 416 },     -- Patas
    [16406] = { str = string.char(5, 0, 1, 0), cost = 144 },     -- Baghnakhs
    [16470] = { str = string.char(9, 0, 2, 0), cost = 300 },     -- Gully
    [13871] = { str = string.char(6, 0, 0x43, 0), cost = 302 },  -- Iron Visor
    [13783] = { str = string.char(6, 0, 0x44, 0), cost = 464 },  -- Iron Scale Mail
    [12938] = { str = string.char(7, 0, 0x32, 0), cost = 322 },  -- Sollerets
    [16644] = { str = string.char(6, 0, 0x0D, 0), cost = 540 },  -- Mythril Axe
}

UNITY_ITEM = {
    [8973] = { idx = 1, special = false },  -- SP Gobbie Key
    [4181] = { idx = 2, special = false },  -- Warp Scroll
    [5945] = { idx = 12, special = false }, -- Prize Powder
    [8979] = { idx = 0, special = true },   -- Imperator's Wing
    [8982] = { idx = 2, special = true },   -- Intuila's Hide
    [8987] = { idx = 7, special = true },   -- Strix's Tailfeather
    [8989] = { idx = 9, special = true },   -- Arke's Wing
    [8990] = { idx = 10, special = true },  -- Largantua's Shard
    [9031] = { idx = 19, special = true },  -- Vedrfolnir's Wing
    [9047] = { idx = 20, special = true },  -- Immani. Hide
    [9051] = { idx = 23, special = true },  -- Camahueto's Fur
    [9094] = { idx = 33, special = true },  -- Clawberry's Coat
    [9097] = { idx = 35, special = true },  -- Mhuufya's Beak
    [9098] = { idx = 39, special = true },  -- G. Grenade's Ash
    [9151] = { idx = 40, special = true },  -- Sovereign's Hide
    [8974] = { idx = 53, special = true },  -- Harold's Ore
    [8975] = { idx = 54, special = true },  -- Belinda's Hide
}

cbuy = nil
cbuy_last_seq = nil
cbuy_last_bought = 0
cfarm = nil
release_pkt = nil
cfarm_progress = nil
cfarm_dirty = false

function emit_convert(active, shop, item, bought, total, phase)
    cfarm_progress = { active = active, shop = shop or '', item = item or 0, bought = bought or 0, total = total or 0, phase = phase or '' }
    cfarm_dirty = true
end

function emit_convert_off()
    if cfarm_progress and cfarm_progress.active then
        local p = cfarm_progress
        emit_convert(false, p.shop, p.item, p.bought, p.total, 'stopped')
    end
end

function build_convert()
    local p = cfarm_progress
    if not p then return nil end
    return '{"t":"convert","active":' .. (p.active and 'true' or 'false')
        .. ',"shop":"' .. p.shop .. '","item":' .. p.item
        .. ',"bought":' .. p.bought .. ',"total":' .. p.total
        .. ',"phase":"' .. p.phase .. '"}\n'
end

function cbuy_npc(names)
    local arr = windower.ffxi.get_mob_array()
    local me = windower.ffxi.get_mob_by_target('me')
    if not arr or not me or not me.x then return nil end
    for _, v in pairs(arr) do
        if v and v.name and names[v.name] and v.x then
            local dx, dy = v.x - me.x, v.y - me.y
            if dx * dx + dy * dy < 100 then return { id = v.id, index = v.index } end
        end
    end
    return nil
end

function cbuy_name(id)
    return (res.items[id] and res.items[id].en) or tostring(id)
end

function cbuy_unity_select(opt, uk1, automated)
    cbuy.t = os.clock()
    local p = string.char(0x5B, 0x0A, 0, 0) .. le4(cbuy.npc_id) .. le2(opt) .. le2(uk1)
        .. le2(cbuy.npc_index) .. string.char(automated and 1 or 0, 0) .. le2(cbuy.zone) .. le2(cbuy.menu)
    pcall(windower.packets.inject_outgoing, 0x5B, p)
end

-- ALWAYS send this when an NPC menu interaction is interrupted, or the character
-- freezes in the event. release_pkt is the option-0 close, stored when the menu opened.
function cbuy_release()
    if release_pkt and packets_ok then pcall(windower.packets.inject_outgoing, 0x5B, release_pkt) end
    release_pkt = nil
    -- Preserve however much this batch bought before it stalled/timed out. Zeroing it made cfarm read
    -- got=0 and FINISH the whole job early, leaving the already-bought items unsold in inventory (the
    -- "5544/9999 Done" multibox bug). Keeping the partial makes cfarm sell what it got and retry the rest.
    cbuy_last_bought = (cbuy and cbuy.bought) or 0
    cbuy = nil
end

function cbuy_buy_one()
    if not cbuy or cbuy.shop ~= 'sparks' then return end
    if cbuy.bought < cbuy.want then
        cbuy.bought = cbuy.bought + 1
        cbuy.t = os.clock()
        pcall(windower.packets.inject_outgoing, 0x5B, cbuy.buy_packet)
    end
    if cbuy.bought >= cbuy.want then
        pcall(windower.packets.inject_outgoing, 0x5B, cbuy.end_packet)
        release_pkt = nil
        cbuy_last_bought = cbuy.bought
        if not cbuy.silent then alex_chat(207, '[Alexandria] Bought ' .. cbuy.bought .. ' ' .. cbuy_name(cbuy.item), 'action') end
        cbuy = nil
    end
end

function cbuy_start(shop, item_id, count, silent)
    if cbuy then return end
    if not packets_ok then if not silent then alex_chat(207, '[Alexandria] Packets unavailable', 'error') end return end
    local names = (shop == 'sparks') and SPARKS_NPCS or UNITY_NPCS
    if (shop == 'sparks' and not SPARKS_OPT[item_id]) or (shop == 'unity' and not UNITY_ITEM[item_id]) then return end
    local npc = cbuy_npc(names)
    if not npc then if not silent then alex_chat(207, '[Alexandria] ' .. (shop == 'sparks' and 'Sparks' or 'Unity') .. ' vendor not nearby', 'error') end return end
    cbuy = { shop = shop, item = item_id, want = count, bought = 0, npc_id = npc.id, npc_index = npc.index, phase = 'await', t = os.clock(), silent = silent }
    npc_poke(npc.id, npc.index)
end

function cbuy_incoming(id, data)
    if not cbuy then return nil end
    if os.clock() - cbuy.t > 10 then cbuy_release(); return nil end
    if id == 0x034 and cbuy.phase == 'await' then
        if cbuy.shop == 'sparks' then
            local balance = data:unpack('I', 13)
            local inv = windower.ffxi.get_bag_info(0)
            local free = inv and ((inv.max or 80) - (inv.count or 0)) or 0
            local opt = SPARKS_OPT[cbuy.item]
            cbuy.buy_packet = string.char(0x5B, 0x0A, 0, 0) .. data:sub(5, 8) .. opt.str .. data:sub(0x29, 0x2A) .. string.char(1, 0) .. data:sub(0x2B, 0x2E)
            cbuy.end_packet = string.char(0x5B, 0x0A, 0, 0) .. data:sub(5, 8) .. string.char(1, 0, 0, 0) .. data:sub(0x29, 0x2A) .. string.char(0, 0) .. data:sub(0x2B, 0x2E)
            release_pkt = cbuy.end_packet
            cbuy.want = math.min(cbuy.want, math.floor(balance / opt.cost), free)
            if cbuy.want <= 0 then
                if not cbuy.silent then alex_chat(207, '[Alexandria] Cannot afford any ' .. cbuy_name(cbuy.item), 'error') end
                cbuy_release()
                return true
            end
            cbuy.phase = 'buying'
            cbuy_buy_one()
            return true
        else
            local ok, p = pcall(packets.parse, 'incoming', data)
            cbuy.menu = (ok and p and p['Menu ID']) or 0
            cbuy.zone = (ok and p and p['Zone']) or (windower.ffxi.get_info() or {}).zone or 0
            release_pkt = string.char(0x5B, 0x0A, 0, 0) .. le4(cbuy.npc_id) .. le2(0) .. le2(0) .. le2(cbuy.npc_index) .. string.char(0, 0) .. le2(cbuy.zone) .. le2(cbuy.menu)
            cbuy_unity_select(10, 0, true)
            cbuy.phase = 'sub1'
            return true
        end
    elseif (id == 0x05C or id == 0x034) and cbuy.shop == 'unity' and cbuy.phase ~= 'await' then
        local it = UNITY_ITEM[cbuy.item]
        if cbuy.phase == 'sub1' then
            if it.special then
                cbuy_unity_select((cbuy.want % 8) * 8192 + it.idx * 32 + 9, math.floor(cbuy.want / 8), true)
                cbuy.phase = 'close'
            else
                cbuy_unity_select(it.idx * 32 + 3, 0, true)
                cbuy.phase = 'sub2'
            end
            return true
        elseif cbuy.phase == 'sub2' then
            cbuy_unity_select((cbuy.want % 8) * 8192 + it.idx * 32 + 4, math.floor(cbuy.want / 8), true)
            cbuy.phase = 'close'
            return true
        elseif cbuy.phase == 'close' then
            cbuy_unity_select(0, 0, false)
            release_pkt = nil
            cbuy_last_bought = cbuy.want
            if not cbuy.silent then alex_chat(207, '[Alexandria] Bought ' .. cbuy.want .. ' ' .. cbuy_name(cbuy.item), 'action') end
            cbuy = nil
            return true
        end
    end
    return nil
end

-- Currency farm: buy a gil-flippable item with a points currency and direct-sell
-- it as you go, in inventory-sized batches, until the target count is bought.
function cfarm_count(id)
    local inv = windower.ffxi.get_items(0)
    if not inv then return 0 end
    local n = 0
    for s = 1, (inv.max or 80) do
        local it = inv[s]
        if type(it) == 'table' and it.id == id then n = n + (it.count or 0) end
    end
    return n
end

function cfarm_capacity(id)
    local bi = windower.ffxi.get_bag_info(0)
    local free = bi and ((bi.max or 80) - (bi.count or 0)) or 0
    local stack = (res.items[id] and res.items[id].stack) or 1
    return free * stack
end

function cfarm_sell(id)
    if not cfarm then return end
    if os.clock() < shop_manual_until then return end
    local inv = windower.ffxi.get_items(0)
    if not inv then return end
    local now = os.clock()
    for s = 1, (inv.max or 80) do
        local it = inv[s]
        if type(it) == 'table' and it.id == id and it.status == 0 and not shop_no_sale(id) then
            if not cfarm.sold[s] or now - cfarm.sold[s] > 3 then
                shop_do_sell(id, s, it.count or 1)
                cfarm.sold[s] = now
            end
        end
    end
end

-- Advance a chained farm to its next queued job (currency dump), or stop.
function cfarm_next(queue, delay)
    if queue and #queue > 0 then
        local n = table.remove(queue, 1)
        delay = math.max(0, tonumber(delay) or 0)
        return { shop = n.shop, item = n.item, remaining = n.want, total = n.want, bought = 0, phase = delay > 0 and 'wait' or 'startbuy', t = 0, sold = {}, queue = queue, delay = delay, wait_t = os.clock() }
    end
    return nil
end

function cfarm_tick(now)
    if not cfarm or cbuy then return end
    local f = cfarm
    if f.phase == 'wait' then
        if now - (f.wait_t or now) >= (f.delay or 0) then f.phase = 'startbuy'; f.t = 0 end
        return
    end
    if now - f.t < 0.4 then return end
    f.t = now
    if f.phase == 'startbuy' then
        local cap = cfarm_capacity(f.item)
        if cap <= 0 then f.phase = 'sell'; return end
        local batch = math.min(f.remaining, cap, 9999)
        if batch <= 0 then f.phase = 'finish'; return end
        f.batch = batch
        f.sold = {}
        cbuy_last_bought = 0
        cbuy_start(f.shop, f.item, batch, true)
        if not cbuy then alex_chat(207, '[Alexandria] Conversion: ' .. (f.shop == 'sparks' and 'Sparks' or 'Unity') .. ' vendor not nearby', 'error'); cfarm = cfarm_next(f.queue, f.delay); if not cfarm then emit_convert_off() end; return end
        f.phase = 'buying'
        emit_convert(true, f.shop, f.item, f.bought or 0, f.total or 0, 'buying')
    elseif f.phase == 'buying' then
        local got = cbuy_last_bought or 0
        f.bought = (f.bought or 0) + got
        f.remaining = math.max(0, f.remaining - got)
        if got > 0 then
            f.retries = 0
            f.phase = 'sell'
            emit_convert(true, f.shop, f.item, f.bought, f.total or 0, 'selling')
        elseif f.remaining > 0 and (f.retries or 0) < 4 then
            -- The batch bought nothing (the NPC menu never opened -- multibox contention drops the response).
            -- Re-poke and retry a few times instead of declaring the whole job done with currency unspent.
            f.retries = (f.retries or 0) + 1
            f.phase = 'startbuy'
        else
            f.phase = 'finish'
        end
    elseif f.phase == 'sell' then
        cfarm_sell(f.item)
        f.phase = 'clear'
        f.clear_t = now
    elseif f.phase == 'clear' then
        if cfarm_count(f.item) == 0 then
            f.phase = (f.remaining > 0) and 'startbuy' or 'finish'
        elseif now - f.clear_t > 10 then
            f.phase = (f.remaining > 0) and 'startbuy' or 'finish'
        else
            cfarm_sell(f.item)
        end
    elseif f.phase == 'finish' then
        alex_chat(207, '[Alexandria] Conversion Done: Sold ' .. (f.bought or 0) .. ' ' .. cbuy_name(f.item), 'action')
        cfarm = cfarm_next(f.queue, f.delay)
        if not cfarm then emit_convert(false, f.shop, f.item, f.bought or 0, f.total or 0, 'done') end
    end
end

function cfarm_start(shop, item_id, want)
    if cfarm or cbuy then return end
    if (shop == 'sparks' and not SPARKS_OPT[item_id]) or (shop == 'unity' and not UNITY_ITEM[item_id]) then return end
    if want <= 0 then alex_chat(207, '[Alexandria] Conversion: Nothing to buy', 'error'); return end
    cfarm = { shop = shop, item = item_id, remaining = want, total = want, bought = 0, phase = 'startbuy', t = 0, sold = {} }
end

-- Currency dump: read the live balance and convert it to gil. `only` limits to one
-- shop ('sparks' or 'unity'); nil does both. The affordable amount is computed here
-- from the live currency, so the caller never has to know the balance.
function cfarm_start_all(only, delay)
    if cfarm or cbuy then return end
    if not packets_ok then alex_chat(207, '[Alexandria] packets unavailable', 'error') return end
    currency_request()
    local sparks = (currency_cur1 and tonumber(currency_cur1['Sparks of Eminence'])) or 0
    local accolades = (currency_cur1 and tonumber(currency_cur1['Unity Accolades'])) or 0
    local acheron = math.floor(sparks / (SPARKS_OPT[12385] and SPARKS_OPT[12385].cost or 2755))
    local powder = math.floor(accolades / (UNITY_ITEM[5945] and UNITY_ITEM[5945].cost or 10))
    local queue = {}
    if (not only or only == 'sparks') and acheron > 0 then queue[#queue + 1] = { shop = 'sparks', item = 12385, want = acheron } end
    if (not only or only == 'unity') and powder > 0 then queue[#queue + 1] = { shop = 'unity', item = 5945, want = powder } end
    if #queue == 0 then alex_chat(207, '[Alexandria] Conversion: Not enough currency to convert', 'error'); return end
    local first = table.remove(queue, 1)
    delay = math.max(0, tonumber(delay) or 0)
    cfarm = { shop = first.shop, item = first.item, remaining = first.want, total = first.want, bought = 0, phase = delay > 0 and 'wait' or 'startbuy', t = 0, sold = {}, queue = queue, delay = delay, wait_t = os.clock() }
    emit_convert(true, first.shop, first.item, 0, first.want, 'buying')
end

local function ah_find_item_index(id, need)
    local inv = windower.ffxi.get_items(0)
    if not inv then return nil end
    for i = 1, (inv.max or 80) do
        local it = inv[i]
        if type(it) == 'table' and it.id == id and (it.count or 0) >= need and it.status == 0 then return i end
    end
    return nil
end

function ah_buy(id, single, price)
    if not packets_ok then return false end
    local slot = ah_find_empty() or 7
    local p = string.char(0x4E, 0x1E, 0, 0, 0x0E, slot, 0, 0) .. le4(price) .. le2(id) .. string.char(0, 0)
        .. string.char(single) .. string.rep('\0', 43)
    ah_last_bid = { name = (res.items[id] and res.items[id].en) or '', price = price }
    pcall(windower.packets.inject_outgoing, 0x4E, p)
    return true
end

function ah_sell(id, single, price)
    if not packets_ok then return false end
    local r = res.items[id]
    if not r then return false end
    local need = (single == 1) and 1 or (r.stack or 1)
    local index = ah_find_item_index(id, need)
    if not index then
        ah_listed(false, id, 0, 0, 'No ' .. (single == 1 and 'single' or 'stack') .. ' in inventory')
        return false
    end
    local p = string.char(0x4E, 0x1E, 0, 0, 0x04, 0, 0, 0) .. le4(price) .. le2(index) .. le2(id)
        .. string.char(single) .. string.rep('\0', 43)
    ah_last4e = p
    pcall(windower.packets.inject_outgoing, 0x4E, p)
    return true
end

function ah_clear_slot(slot)
    if not packets_ok or slot < 0 or slot > 6 then return false end
    local p = string.char(0x4E, 0x1E, 0, 0, 0x10, slot) .. string.rep('\0', 54)
    pcall(windower.packets.inject_outgoing, 0x4E, p)
    return true
end

function ah_cancel_slot(slot)
    -- LOT_CANCEL (Command 0x0C): delist an item that is currently On auction.
    -- Param is empty; only the slot (AucWorkIndex) is sent.
    if not packets_ok or slot < 0 or slot > 6 then return false end
    local p = string.char(0x4E, 0x1E, 0, 0, 0x0C, slot) .. string.rep('\0', 54)
    pcall(windower.packets.inject_outgoing, 0x4E, p)
    return true
end

function ah_enqueue(fn)
    ah_queue[#ah_queue + 1] = fn
end

function ah_update_slot(p, raw)
    local slot = p.Slot
    local status = p['Sale status']
    if not ah_box then ah_box = {} end
    if slot == nil or slot == 7 or status == 0x02 or status == 0x04 or status == 0x10 then return end
    if status == 0x00 then
        ah_box[slot] = { status = 'Empty' }
    else
        ah_box[slot] = ah_box[slot] or {}
        local b = ah_box[slot]
        if status == 0x03 then b.status = 'On auction'
        elseif status == 0x0A or status == 0x0C or status == 0x15 then b.status = 'Sold'
        elseif status == 0x0B or status == 0x0D or status == 0x16 then b.status = 'Not Sold' end
        b.item = p.Item
        b.count = p.Count
        b.price = p.Price
        b.timestamp = p.Timestamp
    end
    ah_initialized = true
    ah_dirty = true
end

local AH_ERR = {
    [0xFF] = 'Already on auction', [0xFE] = 'Item system error', [0xFD] = 'Bad slot',
    [0xFC] = 'Not enough gil for the listing fee', [0xFB] = 'Item not suitable for that slot',
    [0xFA] = 'Invalid item', [0xF9] = 'Wrong place', [0xF8] = 'Too many auctions in progress',
    [0xF7] = 'Auction house busy, try again', [0xF6] = 'Auction limit reached', [0xF3] = 'Last slot error',
    [0xF2] = 'Item is locked', [0xF1] = 'Not a full stack', [0xF0] = 'Item cannot be posted',
    [0xEF] = 'Item is not auctionable', [0xEE] = 'No item in work', [0xE5] = 'Inventory full',
    [0xDA] = 'Item already gone', [0xF5] = 'Auction house services unavailable', [0x00] = 'Listing failed',
}
local function ah_err_text(code)
    return AH_ERR[code] or ('Listing failed (code ' .. tostring(code) .. ')')
end
local BID_ERR = {
    [0xC5] = 'outbid, price too low, or no longer available',
    [0xE5] = 'inventory is full',
    [0xE4] = 'you already have that one-of-a-kind item',
    [0xFC] = 'not enough gil',
    [0xFF] = 'auction house is closed',
    [0xF5] = 'auction house services unavailable',
}
local function ah_bid_err(code)
    return BID_ERR[code] or ('purchase failed (code ' .. tostring(code) .. ')')
end
function ah_listed(ok, id, count, price, reason)
    local nm = (id and id > 0 and res.items[id] and res.items[id].en) or ''
    queue_send('{"t":"ahlisted","ok":' .. (ok and 'true' or 'false') .. ',"id":' .. (id or 0)
        .. ',"n":"' .. esc(nm) .. '","c":' .. (count or 0) .. ',"p":' .. (price or 0)
        .. ',"reason":"' .. esc(reason or '') .. '"}\n')
end

function ah_handle_incoming(data)
    local ok, p = pcall(packets.parse, 'incoming', data)
    if not ok or not p then return end
    local t = p.Type
    local r = data:byte(7)
    if t == 0x04 then
        -- Sell proposal accepted (fee returned). Fire the commit shortly after,
        -- like AuctionHelper (~1s) instead of waiting on the 8s queue.
        if r == 0x01 then
            local slot = ah_find_empty()
            local gil = (windower.ffxi.get_items() or {}).gil or 0
            local fee = p.Fee or 0
            if ah_last4e and slot and ah_last4e:byte(5) == 0x04
                and ah_last4e:byte(3) + ah_last4e:byte(4) == 0 and data:sub(13, 17) == ah_last4e:sub(13, 17) and gil >= fee then
                local last = ah_last4e
                local confirm = string.char(0x4E, 0x1E, 0, 0, 0x0B, slot, 0, 0) .. last:sub(9, 12) .. data:sub(13, 14) .. string.char(0, 0) .. last:sub(17)
                ah_last4e = nil
                coroutine.schedule(function() if packets_ok and ah_usable() then pcall(windower.packets.inject_outgoing, 0x4E, confirm) end end, 1)
            elseif ah_last4e then
                ah_last4e = nil
                ah_busy = false
                ah_listed(false, p.Item or 0, 0, 0, (gil < fee) and 'Not enough gil for the listing fee' or 'No empty auction slot')
            end
        elseif ah_last4e and r ~= 0x02 then
            ah_last4e = nil
            ah_busy = false
            ah_err_pending = { id = p.Item or 0, reason = ah_err_text(r), t = os.clock() }
        end
    elseif t == 0x0A then
        if r == 1 then ah_update_slot(p, data) end
    elseif t == 0x0B then
        if r == 0x01 then
            ah_busy = false
            if ah_err_pending and ah_err_pending.id == (p.Item or 0) then ah_err_pending = nil end
            ah_update_slot(p, data)
            ah_listed(true, p.Item or 0, p.Count or 0, p.Price or 0, nil)
        elseif ah_busy and r ~= 0x02 then
            ah_busy = false
            ah_err_pending = { id = p.Item or 0, reason = ah_err_text(r), t = os.clock() }
        end
    elseif t == 0x0D then
        if r == 1 then ah_update_slot(p, data) end
    elseif t == 0x0C then
        -- LOT_CANCEL (delist) result.
        if r ~= 0x02 then ah_busy = false end
        if r == 0x01 then
            ah_update_slot({ Slot = data:byte(6), ['Sale status'] = 0x00 }, data)
            queue_send('{"t":"ahmsg","ok":true,"text":"Delisted, item returned to inventory"}\n')
        elseif r ~= 0x02 then
            queue_send('{"t":"ahmsg","ok":false,"text":"' .. esc('Delist failed: ' .. ah_err_text(r)) .. '"}\n')
        end
    elseif t == 0x10 then
        if r == 1 then
            ah_busy = false
            ah_update_slot({ Slot = data:byte(6), ['Sale status'] = 0x00 }, data)
        end
    elseif t == 0x0E then
        if ah_last_bid and r ~= 0x02 then
            local nm = ah_last_bid.name
            ah_last_bid = nil
            ah_busy = false
            if r == 0x01 then
                queue_send('{"t":"ahmsg","ok":true,"text":"' .. esc('Bought ' .. (nm ~= '' and nm or 'item')) .. '"}\n')
            else
                queue_send('{"t":"ahmsg","ok":false,"text":"' .. esc('Could not buy ' .. (nm ~= '' and nm or 'item') .. ': ' .. ah_bid_err(r)) .. '"}\n')
            end
        end
    end
end

function ah_start_catalog()
    if not ah_cat_list then
        ah_cat_list = {}
        for _, item in pairs(res.items) do
            if type(item) == 'table' and item.en and item.id and item.id > 0
                and not (type(item.flags) == 'table' and item.flags['No Auction']) then
                ah_cat_list[#ah_cat_list + 1] = item
            end
        end
    end
    ah_cat_i = 0
    ah_cat_run = true
    queue_send('{"t":"ahcatstart","n":' .. #ah_cat_list .. '}\n')
end

local function ah_jobs_json(jobs)
    if type(jobs) ~= 'table' then return '[]' end
    local out = {}
    for jn in pairs(jobs) do out[#out + 1] = '"' .. esc(tostring(jn)) .. '"' end
    return '[' .. table.concat(out, ',') .. ']'
end

local function ah_num(v, default)
    return (type(v) == 'number') and v or default
end

function ah_stream_catalog()
    if not ah_cat_run or not ah_cat_list then return end
    local parts = {}
    local stop = math.min(ah_cat_i + 250, #ah_cat_list)
    for i = ah_cat_i + 1, stop do
        local it = ah_cat_list[i]
        parts[#parts + 1] = '{"id":' .. it.id .. ',"n":"' .. esc(it.en) .. '","cat":"' .. esc(tostring(it.category or ''))
            .. '","lvl":' .. ah_num(it.level, 0) .. ',"il":' .. ah_num(it.item_level, 0) .. ',"j":' .. ah_jobs_json(it.jobs) .. ',"st":' .. ah_num(it.stack, 1) .. '}'
    end
    ah_cat_i = stop
    if #parts > 0 then queue_send('{"t":"ahcat","items":[' .. table.concat(parts, ',') .. ']}\n') end
    if ah_cat_i >= #ah_cat_list then
        ah_cat_run = false
        queue_send('{"t":"ahcatend"}\n')
    end
end

function build_ah()
    local parts = {}
    if ah_box then
        for s = 0, 6 do
            local b = ah_box[s]
            if b then
                local nm = (b.item and res.items[b.item] and res.items[b.item].en) or ''
                parts[#parts + 1] = '{"s":' .. s .. ',"st":"' .. esc(b.status or 'Empty') .. '","id":' .. (b.item or 0)
                    .. ',"n":"' .. esc(nm) .. '","c":' .. (b.count or 0) .. ',"p":' .. (b.price or 0) .. ',"ts":' .. (b.timestamp or 0) .. '}'
            end
        end
    end
    return '{"t":"ah","atah":' .. (ah_usable() and 'true' or 'false') .. ',"init":' .. (ah_initialized and 'true' or 'false')
        .. ',"qn":' .. #ah_queue .. ',"slots":[' .. table.concat(parts, ',') .. ']}\n'
end

-- Bags we scan + consolidate across (inventory + the common storages). Wardrobes (8, 10-16) are included
-- so per-item slot routing can send GEAR into them and see gear already inside; the scan only ever picks
-- up stackables (wardrobes hold none) or items with an explicit layout target, and equipped/bazaar slots
-- are skipped, so nothing else in a wardrobe is disturbed. do_move additionally refuses any non-equippable
-- item into a wardrobe, so the general (materials) organize can never glitch junk into one.
local ORGANIZE_SCAN = { 0, 1, 9, 2, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16 }
ORG_WARDROBES = { [8] = true, [10] = true, [11] = true, [12] = true, [13] = true, [14] = true, [15] = true, [16] = true }   -- global: keep off the main-chunk local cap
local ORG_PORTABLE_ORDER = { 5, 6, 7 }
local ORG_DEEP_ORDER = { 1, 9, 2, 4 }

local function build_orgstatus()
    return '{"t":"orgstatus","active":' .. (org_active and 'true' or 'false') ..
        ',"total":' .. org_total .. ',"done":' .. org_done .. '}\n'
end

local function build_orgplan(plan, tname, overflow)
    local parts = {}
    for _, st in ipairs(plan) do
        parts[#parts + 1] = '{"i":' .. st.i .. ',"id":' .. st.id .. ',"n":"' .. esc(st.n) ..
            '","c":' .. st.c .. ',"from":"' .. esc(st.from) .. '","to":"' .. esc(st.to) .. '"}'
    end
    local ov = {}
    if type(overflow) == 'table' then
        for id, cnt in pairs(overflow) do
            if type(cnt) == 'number' and cnt > 0 then
                local nm = (res.items[id] and res.items[id].en) or ('Item ' .. id)
                ov[#ov + 1] = '{"id":' .. id .. ',"n":"' .. esc(nm) .. '","c":' .. cnt .. '}'
            end
        end
    end
    return '{"t":"' .. (tname or 'orgplan') .. '","steps":[' .. table.concat(parts, ',') .. '],"overflow":[' .. table.concat(ov, ',') .. ']}\n'
end

local function org_step_done(i, ok)
    org_done = org_done + 1
    if ok then org_moved = org_moved + 1 end
    queue_send('{"t":"orgstep","i":' .. i .. ',"ok":' .. (ok and 'true' or 'false') .. '}\n')
end

-- Append a block of lines to debug/organize.log (only while org_debug is on). Used
-- to record each run's plan and, after a settle delay, verify what ACTUALLY landed.
function org_log_write(lines)
    if not org_debug or type(lines) ~= 'table' or #lines == 0 then return end
    local base = windower.addon_path .. 'debug'
    if windower.dir_exists and not windower.dir_exists(base) then windower.create_dir(base) end
    local f = io.open(base .. '/organize.log', 'a')
    if f then f:write(table.concat(lines, '\n') .. '\n\n'); f:close() end
end

-- Resolve one planned step into concrete per-slot moves against `snap` (a shared,
-- consumed-slot-tracked inventory snapshot) and queue them on the fast lane. No
-- live inventory reads at run time: the planner already guaranteed the dest has
-- room (merge-aware slot projection) and the server applies moves in send order,
-- so a bag vacated earlier in the plan has space by the time a later move lands.
-- This is what makes the fast burst safe; re-reading get_bag_info/get_items mid
-- burst would see stale state (each move takes a frame or two to reflect).
local function enqueue_org_move(step_i, id, from_bag, to_bag, remaining, snap, used_slot)
    if not snap[from_bag] then snap[from_bag] = windower.ffxi.get_items(from_bag) end
    used_slot[from_bag] = used_slot[from_bag] or {}
    local items = snap[from_bag]
    local moves = {}
    if type(items) == 'table' then
        for s = 1, (items.max or 0) do
            if remaining <= 0 then break end
            local it = items[s]
            if it and it.id == id and it.id ~= 0 and (it.status == nil or it.status == 0) then
                -- Track consumed COUNT per slot, not the whole slot: the planner can
                -- split one source slot across two destinations (two steps), and the
                -- server applies the moves in order, so slot 5 -50 then slot 5 -30
                -- both land. Marking the whole slot used would drop the second move.
                local avail = (it.count or 1) - (used_slot[from_bag][s] or 0)
                if avail > 0 then
                    local take = math.min(avail, remaining)
                    moves[#moves + 1] = { slot = it.slot or s, count = take }
                    used_slot[from_bag][s] = (used_slot[from_bag][s] or 0) + take
                    remaining = remaining - take
                end
            end
        end
    end
    if #moves == 0 then
        enqueue_org(function() org_step_done(step_i, false) end)
        return
    end
    for mi, mv in ipairs(moves) do
        local fb, tb, slot, count, last = from_bag, to_bag, mv.slot, mv.count, (mi == #moves)
        enqueue_org(function()
            windower.ffxi.move_item(fb, tb, slot, count)
            if last then org_step_done(step_i, true) end
        end)
    end
end

local function do_organize(rules, preview)
    local keep = ids_for_names(rules.keep)
    local keepsingle = ids_for_names(rules.keepSingle)
    local always = ids_for_names(rules.alwaysBring)
    local store_usable = rules.storeUsable ~= false
    local reserve = tonumber(rules.reserve) or 3
    local strict_inventory = rules.strictInventory == true

    local keepqty = {}
    if type(rules.keepQty) == 'table' then
        for _, ent in ipairs(rules.keepQty) do
            if type(ent) == 'table' and type(ent.item) == 'string' then
                local q = tonumber(ent.qty)
                if q and q > 0 then
                    for _, qid in ipairs(ids_for_name_entry(ent.item)) do
                        keepqty[qid] = ent.stacks and (q * ((res.items[qid] and res.items[qid].stack) or 1)) or q
                    end
                end
            end
        end
    end

    local layout_map = {}
    if type(rules.layout) == 'table' then
        for _, ent in ipairs(rules.layout) do
            if type(ent) == 'table' and type(ent.item) == 'string' and type(ent.bags) == 'table' then
                local lbags = {}
                for _, b in ipairs(ent.bags) do local bid = tonumber(b); if bid then lbags[#lbags + 1] = bid end end
                if #lbags > 0 then
                    for _, lid in ipairs(ids_for_name_entry(ent.item)) do layout_map[lid] = lbags end
                end
            end
        end
    end

    -- Storable destinations + projected free-slot tracking. bag_free is updated
    -- live as we PLAN moves, so the planner can vacate a bag (by moving other
    -- items out) and then use that freed space for something else.
    local storable = {}
    local is_storable_set = {}
    for _, bid in ipairs(rules.storableBags or {}) do
        local id = tonumber(bid)
        local info = windower.ffxi.get_bag_info(id)
        if info and info.enabled then
            storable[#storable + 1] = id
            is_storable_set[id] = true
        end
    end

    local bag_free = {}
    for _, bid in ipairs(ORGANIZE_SCAN) do
        local info = windower.ffxi.get_bag_info(bid)
        bag_free[bid] = (info and info.enabled) and ((info.max or 80) - (info.count or 0)) or 0
    end

    -- Snapshot every stackable item's total per bag (the consolidation map).
    local by_bag = {}
    local inv_have = {}
    for _, bid in ipairs(ORGANIZE_SCAN) do
        local items = windower.ffxi.get_items(bid)
        if type(items) == 'table' and items.enabled then
            for s = 1, (items.max or 0) do
                local it = items[s]
                -- Only count movable stacks; leave bazaar (status 25) and equipped
                -- (status 5) slots out of the plan entirely.
                if it and it.id and it.id ~= 0 and (it.status == nil or it.status == 0) then
                    local item = res.items[it.id]
                    if item and ((item.stack or 1) > 1 or layout_map[it.id]) then
                        by_bag[it.id] = by_bag[it.id] or {}
                        by_bag[it.id][bid] = (by_bag[it.id][bid] or 0) + (it.count or 1)
                        if bid == 0 then inv_have[it.id] = (inv_have[it.id] or 0) + (it.count or 1) end
                    end
                end
            end
        end
    end

    -- Projected per-bag item counts, so destination slot math is merge-aware:
    -- items moved into a bag that already holds a partial stack fill it (the
    -- end-of-run stack_items realizes the merge) instead of each move claiming a
    -- fresh slot. Without this the planner over-counts destination slots when
    -- partial stacks are present and defers items that actually fit, which is
    -- why large organizes needed several runs to finish.
    local proj = {}
    for iid, bmap in pairs(by_bag) do
        for b, c in pairs(bmap) do proj[b] = proj[b] or {}; proj[b][iid] = c end
    end

    local plan = {}
    local touched = {}
    local org_overflow = {}   -- id -> count that couldn't be placed in its routed bag (destination full)
    local function add_step(id, from, to, count)
        plan[#plan + 1] = { i = #plan, id = id, n = (res.items[id] and res.items[id].en or ('Item ' .. id)),
            c = count, from = bag_name(from), to = bag_name(to), _from = from, _to = to }
        queue_icon(id)
    end

    -- Record a move and update projected space. Source frees the slots its stacks
    -- vacate; destination only claims the NEW slots left after the incoming count
    -- merges into any partial stack already there.
    local function do_move(id, from, to, cnt)
        -- HARD GATE: wardrobes only accept equipment. Refuse to move any item that has no equip slot into
        -- one, regardless of how it got routed there (slot rule, tag rule, or explicit preset). res.items
        -- .slots is the equip-slot bitmask; nil/0 = not equippable. Returns false so callers can try the
        -- next target instead of counting a move that never happened.
        if ORG_WARDROBES[to] then
            -- Windower parses res.items[id].slots into a TABLE of equip-slot indices (e.g. {5}=body, {4}=head,
            -- {1,0}=weapon); non-equippable items (materials/usables) have no slots table. Equippable = a
            -- non-empty slots table. (Do NOT test it as a number -- that rejected every piece of gear.)
            local r = res.items[id]
            if not (r and type(r.slots) == 'table' and next(r.slots) ~= nil) then return false end
        end
        add_step(id, from, to, cnt)
        local stack = (res.items[id] and res.items[id].stack) or 1
        local pf = (proj[from] and proj[from][id]) or 0
        local pt = (proj[to] and proj[to][id]) or 0
        local freed = math.ceil(pf / stack) - math.ceil(math.max(0, pf - cnt) / stack)
        local used = math.ceil((pt + cnt) / stack) - math.ceil(pt / stack)
        bag_free[from] = (bag_free[from] or 0) + freed
        bag_free[to] = (bag_free[to] or 0) - used
        proj[from] = proj[from] or {}; proj[from][id] = pf - cnt
        proj[to] = proj[to] or {}; proj[to][id] = pt + cnt
        touched[to] = true
        return true
    end

    -- A storable bag with room. Consumables and AH-sellables prefer portable
    -- bags (Satchel/Sack/Case); EX / bulk / non-sellable prefer deep storage
    -- (Safe/Safe2/Storage/Locker). Within the preferred zone, the bag already
    -- holding the most copies wins so split stacks consolidate.
    local function storable_home(id)
        local info = res.items[id]
        local sellable = info and ((info.category == 'Usable') or ((tonumber(info.ah) or 0) > 0))
        local first = sellable and ORG_PORTABLE_ORDER or ORG_DEEP_ORDER
        local second = sellable and ORG_DEEP_ORDER or ORG_PORTABLE_ORDER
        local order = {}
        for _, b in ipairs(first) do if is_storable_set[b] then order[#order + 1] = b end end
        for _, b in ipairs(second) do if is_storable_set[b] then order[#order + 1] = b end end
        local best, bestc = nil, -1
        for _, b in ipairs(order) do
            if (bag_free[b] or 0) > 0 then
                local c = (by_bag[id] and by_bag[id][b]) or 0
                if c > bestc then best = b; bestc = c end
            end
        end
        return best
    end

    -- Plan one item. Returns true if settled (planned or nothing-to-do), false
    -- if it should be retried later (its target bag had no room YET).
    local function plan_item(id)
        local bags = by_bag[id]
        local item = res.items[id]
        if not item then return true end
        local usable_block = (item.category == 'Usable') and not store_usable
        local stack = item.stack or 1

        if keepqty[id] then
            local target = keepqty[id]
            -- Excess above the keep target must go to real storage, never Inventory. A tag
            -- routed to Inventory (bag 0) would otherwise make the excess-store loop attempt
            -- an inventory->inventory move, so drop bag 0 from the home list here. The
            -- explicit keep-N Rule wins over routing-to-Inventory for the same item.
            local home_list = storable
            if layout_map[id] then
                local filtered = {}
                for _, b in ipairs(layout_map[id]) do if b ~= 0 then filtered[#filtered + 1] = b end end
                if #filtered > 0 then home_list = filtered end
            end
            local is_home = {}
            for _, b in ipairs(home_list) do is_home[b] = true end
            local inv_now = inv_have[id] or 0
            if inv_now > target then
                local excess = inv_now - target
                for _, t in ipairs(home_list) do
                    if excess <= 0 then break end
                    local free = bag_free[t] or 0
                    if free > 0 then
                        local take = math.min(excess, free * stack)
                        if take > 0 then do_move(id, 0, t, take); excess = excess - take end
                    end
                end
                inv_now = target + excess
            end
            for bid, cnt in pairs(bags) do
                if bid ~= 0 then
                    local remaining = cnt
                    if inv_now < target and (bag_free[0] or 0) > reserve then
                        local take = math.min(remaining, target - inv_now)
                        if take > 0 then do_move(id, bid, 0, take); remaining = remaining - take; inv_now = inv_now + take end
                    end
                    if remaining > 0 and not is_home[bid] then
                        for _, t in ipairs(home_list) do
                            if remaining <= 0 then break end
                            local free = bag_free[t] or 0
                            if free > 0 then
                                local take = math.min(remaining, free * stack)
                                if take > 0 then do_move(id, bid, t, take); remaining = remaining - take end
                            end
                        end
                    end
                end
            end
            touched[0] = true
            return true
        end

        if layout_map[id] then
            local targets = layout_map[id]
            local is_target = {}
            for _, t in ipairs(targets) do is_target[t] = true end
            -- Read the item's copies from the LIVE projected state (proj is kept in sync by do_move as the
            -- plan is built), NOT the initial by_bag snapshot, so an item revisited on a later pass never
            -- re-moves copies that already landed. Only the copies outside a target bag need to move.
            local srcs = {}
            for b, pc in pairs(proj) do
                local c = pc[id]
                if c and c > 0 and not is_target[b] then srcs[#srcs + 1] = { bag = b, cnt = c } end
            end
            if #srcs == 0 then touched[targets[1]] = true; return true end
            -- Move whatever fits into the targets right now. If some copies still cannot fit because every
            -- target is full THIS pass, return false so the multi-pass loop retries them AFTER other items
            -- have vacated the target. That is what lets a full (80/80) wardrobe be emptied of its non-
            -- matching gear first, then packed with the slot it is meant to hold -- in a single Organize run.
            for _, s in ipairs(srcs) do
                local remaining = s.cnt
                for _, t in ipairs(targets) do
                    if remaining <= 0 then break end
                    if (bag_free[t] or 0) > 0 then
                        local take = math.min(remaining, (bag_free[t] or 0) * stack)
                        if take > 0 and do_move(id, s.bag, t, take) then remaining = remaining - take end
                    end
                end
            end
            for b, pc in pairs(proj) do
                local c = pc[id]
                if c and c > 0 and not is_target[b] then return false end   -- still stuck outside a target: retry
            end
            touched[targets[1]] = true
            return true
        end

        if always[id] then
            for bid, cnt in pairs(bags) do
                if bid ~= 0 and (bag_free[0] or 0) > reserve then do_move(id, bid, 0, cnt) end
            end
            touched[0] = true
            return true
        elseif keep[id] or usable_block then
            touched[0] = true
            return true
        elseif keepsingle[id] then
            for bid, cnt in pairs(bags) do
                if bid ~= 0 and not is_storable_set[bid] then
                    local h = storable_home(id)
                    if h then do_move(id, bid, h, cnt) end
                end
            end
            local have = inv_have[id] or 0
            if have > stack then
                local h = storable_home(id)
                if h then do_move(id, 0, h, have - stack) end
            end
            touched[0] = true
            return true
        else
            -- DEFAULT: consolidate into the largest existing pile. If that bag is
            -- full right now, DEFER (a later pass may free it by moving other
            -- items out), rather than give up.
            local bulk_bag, bulk_count, nbags = nil, -1, 0
            for bid, cnt in pairs(bags) do
                nbags = nbags + 1
                if cnt > bulk_count then bulk_bag = bid; bulk_count = cnt end
            end
            local home_id
            if bulk_bag ~= 0 then
                if (bag_free[bulk_bag] or 0) > 0 then home_id = bulk_bag else return false end
            else
                home_id = storable_home(id)
                if not home_id then return false end
            end
            if nbags == 1 and home_id == bulk_bag then return true end
            local order = { home_id }
            for _, sid in ipairs(storable) do if sid ~= home_id then order[#order + 1] = sid end end
            for bid, cnt in pairs(bags) do
                if bid ~= home_id then
                    local remaining = cnt
                    for _, t in ipairs(order) do
                        if remaining <= 0 then break end
                        if t ~= bid and (bag_free[t] or 0) > 0 then
                            local take = math.min(remaining, (bag_free[t] or 0) * stack)
                            if take > 0 then do_move(id, bid, t, take); remaining = remaining - take end
                        end
                    end
                end
            end
            return true
        end
    end

    -- Multi-pass: items that free space settle first; items waiting on a full bag retry once it has been
    -- vacated. Loop while any pass still ADDS a move (an item that partially moved and returned false stays
    -- unsettled and is retried, and the added steps prove space was freed somewhere). Bounded vs. a runaway.
    local ids = {}
    for id in pairs(by_bag) do ids[#ids + 1] = id end
    -- layout_only restricts a sweep to routed GEAR (layout_map items). The storable/keep branches read the
    -- initial by_bag SNAPSHOT rather than live proj, so re-running them across the staging rounds would
    -- re-plan the same material moves every round (the duplicate Inventory->Storage steps that showed up as
    -- "skipped"). The first sweep does the full organize; the staging rounds re-sweep gear only.
    local function sweep(layout_only)
        local settled = {}
        for _ = 1, 40 do
            local before = #plan
            for _, id in ipairs(ids) do
                if not settled[id] and (not layout_only or layout_map[id]) and plan_item(id) then settled[id] = true end
            end
            if #plan == before then break end
        end
    end
    sweep(false)


    -- Whatever gear still sits outside its routed bag is genuine overflow (target truly over capacity or a
    -- deadlock that could not be broken); record it so the preview can warn "N won't fit".
    for lid, ltargets in pairs(layout_map) do
        local is_t = {}
        for _, t in ipairs(ltargets) do is_t[t] = true end
        local left = 0
        for b, pc in pairs(proj) do local c = pc[lid]; if c and c > 0 and not is_t[b] then left = left + c end end
        if left > 0 then org_overflow[lid] = left end
    end

    -- Organize all items: sweep any non-stackable, unprotected item out of the
    -- main bag to its classified home, gear included. Equipped/bazaar items
    -- and anything on the keep/keepQty/alwaysBring/preset lists stay put.
    if strict_inventory then
        local inv = windower.ffxi.get_items(0)
        if type(inv) == 'table' then
            for s = 1, (inv.max or 80) do
                local it = inv[s]
                if it and it.id and it.id ~= 0 and (it.status == nil or it.status == 0) then
                    local id = it.id
                    local info = res.items[id]
                    if info and (info.stack or 1) <= 1
                        and not keep[id] and not keepqty[id] and not always[id] and not layout_map[id]
                        and not ((info.category == 'Usable') and not store_usable) then
                        local h = storable_home(id)
                        if h and (bag_free[h] or 0) > 0 then do_move(id, 0, h, it.count or 1) end
                    end
                end
            end
        end
    end

    if org_debug then
        local dbg = {}
        local info = windower.ffxi.get_info()
        dbg[#dbg + 1] = ('==== ORGANIZE %s | %s | mog=%s ===='):format(os.date('%Y-%m-%d %H:%M:%S'), preview and 'PREVIEW' or 'RUN', tostring(info and info.mog_house))
        local sb = {}
        for _, b in ipairs(rules.storableBags or {}) do sb[#sb + 1] = tostring(b) end
        local nkq, nlm = 0, 0
        for _ in pairs(keepqty) do nkq = nkq + 1 end
        for _ in pairs(layout_map) do nlm = nlm + 1 end
        dbg[#dbg + 1] = ('rules: storableBags={%s} keepQty=%d layout=%d storeUsable=%s reserve=%d strict=%s'):format(table.concat(sb, ','), nkq, nlm, tostring(store_usable), reserve, tostring(strict_inventory))
        local bf = {}
        for _, bid in ipairs(ORGANIZE_SCAN) do bf[#bf + 1] = ('[%d]=%s'):format(bid, tostring(bag_free[bid])) end
        dbg[#dbg + 1] = 'bag_free: ' .. table.concat(bf, ' ')
        -- DIAG: for each equippable piece in inventory, show whether it received a routing target and
        -- made it into the move scan. layout=NONE means the desktop did not route it (slot map/category
        -- miss); layout set but bybag=no means the move scan skipped it.
        local inv0 = windower.ffxi.get_items(0)
        if type(inv0) == 'table' then
            local ng = 0
            for s = 1, (inv0.max or 80) do
                local it = inv0[s]
                if type(it) == 'table' and it.id and it.id ~= 0 then
                    ng = ng + 1
                    if ng <= 30 then
                        local r = res.items[it.id]
                        dbg[#dbg + 1] = ('  inv#%d id=%d %s cat=%s slots=%s status=%s layout=%s'):format(
                            s, it.id, (r and r.en or 'NO-RES-ENTRY'), (r and tostring(r.category) or '?'),
                            (r and tostring(r.slots) or 'nil'), tostring(it.status),
                            (layout_map[it.id] and table.concat(layout_map[it.id], ',') or 'n'))
                    end
                end
            end
            dbg[#dbg + 1] = ('  (items in inventory: %d)'):format(ng)
        end
        dbg[#dbg + 1] = ('PLAN (%d steps):'):format(#plan)
        for _, st in ipairs(plan) do
            dbg[#dbg + 1] = ('  #%d %s x%d  %s(%d)->%s(%d)'):format(st.i, st.n, st.c, st.from, st._from, st.to, st._to)
        end
        org_log_write(dbg)
    end

    if org_debug then
        -- Full machine-readable snapshot for the offline organize simulator: every movable item's real
        -- metadata + position + resolved routing, the initial free-slot map, and the addon's OWN computed
        -- plan (the faithfulness oracle). The simulator replays plan_item against this and must reproduce
        -- `plan` exactly before any fix is trusted. Overwritten each preview.
        local function jesc(s)
            return (tostring(s):gsub('[%z\1-\31\\"]', function(c) return ('\\u%04x'):format(c:byte()) end))
        end
        local p = {}
        p[#p + 1] = '{"ts":"' .. os.date('%Y-%m-%d %H:%M:%S') .. '",'
        local sbj = {}
        for _, b in ipairs(rules.storableBags or {}) do sbj[#sbj + 1] = tostring(b) end
        p[#p + 1] = '"rules":{"storable":[' .. table.concat(sbj, ',') .. '],"portable":[5,6,7],"deep":[1,9,2,4],'
            .. '"wardrobes":[8,10,11,12,13,14,15,16],"reserve":' .. reserve .. ',"storeUsable":' .. tostring(store_usable)
            .. ',"strict":' .. tostring(strict_inventory) .. '},'
        local bfj = {}
        for _, bid in ipairs(ORGANIZE_SCAN) do bfj[#bfj + 1] = '"' .. bid .. '":' .. tostring(bag_free[bid] or 0) end
        p[#p + 1] = '"bag_free":{' .. table.concat(bfj, ',') .. '},"items":['
        local firstItem = true
        for id, bags in pairs(by_bag) do
            local r = res.items[id]
            local slotsj = {}
            if r and type(r.slots) == 'table' then for _, sv in ipairs(r.slots) do slotsj[#slotsj + 1] = tostring(sv) end end
            local bbj = {}
            for b, c in pairs(bags) do bbj[#bbj + 1] = '"' .. b .. '":' .. tostring(c) end
            local lmj = {}
            if layout_map[id] then for _, b in ipairs(layout_map[id]) do lmj[#lmj + 1] = tostring(b) end end
            local equip = (r and type(r.slots) == 'table' and next(r.slots) ~= nil) and 'true' or 'false'
            p[#p + 1] = (firstItem and '' or ',')
                .. '{"id":' .. id .. ',"name":"' .. jesc(r and r.en or '?') .. '","stack":' .. tostring((r and r.stack) or 1)
                .. ',"cat":"' .. jesc((r and r.category) or '?') .. '","ah":' .. tostring((r and tonumber(r.ah)) or 0)
                .. ',"slots":[' .. table.concat(slotsj, ',') .. '],"equip":' .. equip
                .. ',"bybag":{' .. table.concat(bbj, ',') .. '},"layout":[' .. table.concat(lmj, ',') .. ']'
                .. ',"keepqty":' .. tostring(keepqty[id] or 0) .. ',"keep":' .. (keep[id] and 'true' or 'false')
                .. ',"keepsingle":' .. (keepsingle[id] and 'true' or 'false') .. ',"always":' .. (always[id] and 'true' or 'false') .. '}'
            firstItem = false
        end
        p[#p + 1] = '],"plan":['
        for i, st in ipairs(plan) do
            p[#p + 1] = (i == 1 and '' or ',') .. '{"i":' .. st.i .. ',"id":' .. (st.id or 0) .. ',"c":' .. st.c
                .. ',"from":' .. st._from .. ',"to":' .. st._to .. '}'
        end
        p[#p + 1] = '],'
        -- raw: EVERY occupied slot across scanned bags (with status), plus metadata for every id seen -- so the
        -- analyzer can see pieces that never entered by_bag (unrouted gear that got no layout, or equipped
        -- pieces). Those are exactly the ones that sit stuck in a wardrobe and never move.
        p[#p + 1] = '"raw":['
        local firstRaw = true
        local seenMeta = {}
        local metaParts = {}
        for _, bid in ipairs(ORGANIZE_SCAN) do
            local items = windower.ffxi.get_items(bid)
            if type(items) == 'table' and items.enabled then
                for s = 1, (items.max or 0) do
                    local it = items[s]
                    if it and it.id and it.id ~= 0 then
                        p[#p + 1] = (firstRaw and '' or ',') .. '{"id":' .. it.id .. ',"bag":' .. bid .. ',"st":' .. tostring(it.status or 0) .. '}'
                        firstRaw = false
                        if not seenMeta[it.id] then
                            seenMeta[it.id] = true
                            local r = res.items[it.id]
                            local slotsj = {}
                            if r and type(r.slots) == 'table' then for _, sv in ipairs(r.slots) do slotsj[#slotsj + 1] = tostring(sv) end end
                            local lmj = {}
                            if layout_map[it.id] then for _, b in ipairs(layout_map[it.id]) do lmj[#lmj + 1] = tostring(b) end end
                            local equip = (r and type(r.slots) == 'table' and next(r.slots) ~= nil) and 'true' or 'false'
                            metaParts[#metaParts + 1] = '"' .. it.id .. '":{"name":"' .. jesc(r and r.en or '?')
                                .. '","cat":"' .. jesc((r and r.category) or '?') .. '","slots":[' .. table.concat(slotsj, ',')
                                .. '],"equip":' .. equip .. ',"layout":[' .. table.concat(lmj, ',') .. ']}'
                        end
                    end
                end
            end
        end
        p[#p + 1] = '],"allmeta":{' .. table.concat(metaParts, ',') .. '},"overflow":{'
        local ovj = {}
        for lid, n in pairs(org_overflow) do ovj[#ovj + 1] = '"' .. lid .. '":' .. tostring(n) end
        p[#p + 1] = table.concat(ovj, ',') .. '}}'
        local base = windower.addon_path .. 'debug'
        if windower.dir_exists and not windower.dir_exists(base) then windower.create_dir(base) end
        local f = io.open(base .. '/organize_snapshot.json', 'w')
        if f then f:write(table.concat(p)); f:close() end
    end

    -- Preview / dry-run: report the computed plan and bail before enqueuing any
    -- real moves. Uses a distinct feed so the desktop shows it in the Organize
    -- preview instead of driving the live-progress UI.
    if preview then
        queue_send(build_orgplan(plan, 'orgpreview', org_overflow))
        return
    end

    local snap, used_slot = {}, {}
    for _, st in ipairs(plan) do
        enqueue_org_move(st.i, st.id, st._from, st._to, st.c, snap, used_slot)
    end

    -- Merge the gathered partial stacks in every bag we moved into. On the paced
    -- lane so the stack runs AFTER the moves into that bag land, not before.
    for bid in pairs(touched) do
        local b = bid
        enqueue_org(function() windower.ffxi.stack_items(b) end)
    end

    if #plan > 0 then
        org_active = true
        org_total = #plan
        org_done = 0
        org_moved = 0
        org_report_t = os.clock()
        org_stream_t = os.clock()
        if org_debug then
            org_verify = { ts = os.date('%H:%M:%S'), done_at = nil, moved = 0, total = #plan, steps = {} }
            for _, st in ipairs(plan) do
                org_verify.steps[#org_verify.steps + 1] = { id = st.id, n = st.n, from = st._from, to = st._to, want = st.c, src_before = (by_bag[st.id] and by_bag[st.id][st._from]) or 0 }
            end
        end
        queue_send(build_orgplan(plan))
        queue_send(build_orgstatus())
        alex_chat(207, '[Alexandria] auto-organize: ' .. #plan .. ' move(s) planned...', 'progress')
    else
        alex_chat(207, '[Alexandria] auto-organize: nothing to consolidate', 'progress')
    end
end

function do_local_consolidate(target_bags)
    local allowed = nil
    if type(target_bags) == 'table' and #target_bags > 0 then
        allowed = {}
        for _, b in ipairs(target_bags) do local n = tonumber(b); if n then allowed[n] = true end end
    end
    local avail = {}
    local bag_free = {}
    for _, bid in ipairs(store_bags()) do
        local info = windower.ffxi.get_bag_info(bid)
        if info and info.enabled then
            avail[#avail + 1] = bid
            bag_free[bid] = (info.max or 80) - (info.count or 0)
        end
    end
    local by_bag = {}
    for _, bid in ipairs(avail) do
        local items = windower.ffxi.get_items(bid)
        if type(items) == 'table' then
            for s = 1, (items.max or 0) do
                local it = items[s]
                if it and it.id and it.id ~= 0 then
                    local r = res.items[it.id]
                    if r and (r.stack or 1) > 1 then
                        by_bag[it.id] = by_bag[it.id] or {}
                        by_bag[it.id][bid] = (by_bag[it.id][bid] or 0) + (it.count or 1)
                    end
                end
            end
        end
    end
    local moves = 0
    for id, bags in pairs(by_bag) do
        local home, homec, nbags = nil, -1, 0
        for bid, cnt in pairs(bags) do
            nbags = nbags + 1
            if (bag_free[bid] or 0) > 0 and (not allowed or allowed[bid]) and cnt > homec then home = bid; homec = cnt end
        end
        if not home and allowed then
            for _, bid in ipairs(avail) do
                if allowed[bid] and (bag_free[bid] or 0) > 0 then home = bid; break end
            end
        end
        if nbags > 1 and home then
            local stack = (res.items[id] and res.items[id].stack) or 1
            for bid, cnt in pairs(bags) do
                local need = math.ceil(cnt / stack)
                if bid ~= home and (bag_free[home] or 0) >= need then
                    local fb, tb, iid = bid, home, id
                    enqueue_fast(function()
                        local src = windower.ffxi.get_items(fb)
                        if type(src) == 'table' then
                            for s = 1, (src.max or 0) do
                                local it = src[s]
                                if it and it.id == iid and it.id ~= 0 then
                                    windower.ffxi.move_item(fb, tb, s, it.count or 1)
                                end
                            end
                        end
                    end)
                    bag_free[home] = bag_free[home] - need
                    moves = moves + 1
                end
            end
        end
    end
    for _, bid in ipairs(avail) do
        local b = bid
        enqueue_fast(function() windower.ffxi.stack_items(b) end)
    end
    alex_chat(123, '[Alexandria] local consolidate: ' .. moves .. ' move(s) queued', 'action')
end

-- Fire FFXI's own Sort (client packet 0x03A, GP_CLI_COMMAND_ITEM_STACK). Its
-- Category field is the container, so this sorts ANY accessible bag, not just
-- inventory. Mog House bags are only enabled while parked at a moogle, so the
-- get_bag_info gate lets those pass through only when reachable.
function sort_bag(bag)
    if not packets_ok then return end
    bag = tonumber(bag)
    if not bag then return end
    local info = windower.ffxi.get_bag_info(bag)
    if not (info and info.enabled) then return end
    pcall(windower.packets.inject_outgoing, 0x3A, string.char(0x3A, 0x04, 0, 0) .. le4(bag))
end

-- Space the sort packets out rather than firing them all in one frame, so a
-- "sort everything" never machine-guns the server with 0x03A packets at once.
local function sort_bags_staggered(bags, gap)
    gap = gap or 0.5
    local n = 0
    for _, b in ipairs(bags) do
        local bag = tonumber(b)
        if bag then
            coroutine.schedule(function() sort_bag(bag) end, n * gap)
            n = n + 1
        end
    end
end

-- Content signature per bag: sum over distinct item ids of (id, total count).
-- Order- and stack-independent, so a sort (which reorders and merges) never
-- changes it; only a genuine add/remove does. That stops a sort from retriggering
-- itself while still catching new loot.
local function bag_content_sig(bag)
    local items = windower.ffxi.get_items(bag)
    local totals = {}
    if type(items) == 'table' then
        for s = 1, (items.max or 0) do
            local it = items[s]
            if it and it.id and it.id ~= 0 then
                totals[it.id] = (totals[it.id] or 0) + (it.count or 1)
            end
        end
    end
    local sig = 0
    for id, cnt in pairs(totals) do sig = (sig + id * 131 + cnt) % 2147483647 end
    return sig
end

local function autosort_check()
    local todo = {}
    for bag in pairs(autosort_bags) do
        local info = windower.ffxi.get_bag_info(bag)
        if info and info.enabled then
            local s = bag_content_sig(bag)
            if autosort_sig[bag] ~= s then
                autosort_sig[bag] = s
                todo[#todo + 1] = bag
            end
        end
    end
    if #todo > 0 then sort_bags_staggered(todo) end
end

local function resolve_item_id(msg)
    if msg.id then return tonumber(msg.id) end
    if msg.item then local s = ids_for_names({ msg.item }); return next(s) end
    return nil
end

local function held_slots(item_id, max_slots, max_count)
    local inv = windower.ffxi.get_items(0)
    local out = {}
    local remaining = max_count
    local maxn = (inv and inv.max) or 0
    for s = 1, maxn do
        local it = inv[s]
        if it and it.id == item_id and it.id ~= 0 then
            local cnt = it.count or 1
            if remaining and cnt > remaining then cnt = remaining end
            if cnt > 0 then
                out[#out + 1] = { count = cnt, index = it.slot or s }
                if remaining then remaining = remaining - cnt end
            end
            if #out >= max_slots or (remaining and remaining <= 0) then break end
        end
    end
    return out
end

local function do_trade_npc(item_id, target_id, target_index, count)
    if not packets_ok then return end
    -- Resolved at execution time so a repeat/loop re-checks inventory and the
    -- current target, and stops cleanly once the item runs out.
    act_queue[#act_queue + 1] = function()
        local tid, tix = target_id, target_index
        if not tid then
            local t = windower.ffxi.get_mob_by_target('t')
            if not t then return end
            tid = t.id
            tix = t.index
        end
        local held = held_slots(item_id, 8, count)
        if #held == 0 then return end
        local fields = { ['Target'] = tid, ['Target Index'] = tix, ['Number of Items'] = #held }
        for i = 1, 8 do
            fields['Item Count ' .. i] = held[i] and held[i].count or 0
            fields['Item Index ' .. i] = held[i] and held[i].index or 0
        end
        packets.inject(packets.new('outgoing', 0x036, fields))
    end
end

local function do_trade_pc(item_id, count)
    if not packets_ok then return end
    act_queue[#act_queue + 1] = function()
        local held = held_slots(item_id, 8, count)
        if #held == 0 then alex_chat(207, '[Alexandria] trade: item not in inventory', 'error') return end
        for i, h in ipairs(held) do
            packets.inject(packets.new('outgoing', 0x034, { ['Count'] = h.count, ['Item'] = item_id, ['Inventory Index'] = h.index, ['Slot'] = i }))
        end
    end
end

local function do_trade_pc_offer(target_name, items)
    if not packets_ok then return end
    act_queue[#act_queue + 1] = function()
        local t
        if target_name and target_name ~= '' then
            t = resolve_pc_mob(target_name)
        else
            t = windower.ffxi.get_mob_by_target('t')
        end
        if not t or not t.id or t.is_npc then alex_chat(207, '[Alexandria] player trade: no PC target', 'error') return end
        packets.inject(packets.new('outgoing', 0x032, { ['Target'] = t.id, ['Target Index'] = t.index }))
    end
    local slot = 0
    for _, it in ipairs(items) do
        local item_id = resolve_item_id(it)
        local count = tonumber(it.count) or 1
        if item_id and slot < 8 then
            slot = slot + 1
            local trade_slot = slot
            act_queue[#act_queue + 1] = function()
                local held = held_slots(item_id, 1, count)
                if held[1] then
                    packets.inject(packets.new('outgoing', 0x034, { ['Count'] = held[1].count, ['Item'] = item_id, ['Inventory Index'] = held[1].index, ['Slot'] = trade_slot }))
                end
            end
        end
    end
    act_queue[#act_queue + 1] = function()
        packets.inject(packets.new('outgoing', 0x033, { ['Type'] = 2 }))
    end
    alex_chat(207, '[Alexandria] player trade offered', 'action')
end

local function dispatch(line)
    if not json_ok then return end
    local ok, msg = pcall(json.decode, line)
    if not ok or type(msg) ~= 'table' then return end
    if msg.cmd == 'move' and msg.id and msg.from ~= nil and msg.to ~= nil then
        local cnt = tonumber(msg.count) or 1
        if msg.slot ~= nil then
            enqueue_move_exact(tonumber(msg.id), tonumber(msg.from), tonumber(msg.to), tonumber(msg.slot), cnt)
        else
            enqueue_move(tonumber(msg.id), tonumber(msg.from), tonumber(msg.to), cnt)
        end
    elseif msg.cmd == 'stack' then
        enqueue_stack(msg.bag and tonumber(msg.bag) or nil)
    elseif msg.cmd == 'organize' then
        if org_active then
            alex_chat(207, '[Alexandria] organize already running', 'error')
        else
            org_cache_rules(msg)
            do_organize(msg)
        end
    elseif msg.cmd == 'organizepreview' then
        -- Dry-run only: compute + report the plan, never move anything. A distinct
        -- command (not an 'organize' flag) so an out-of-date addon simply ignores it
        -- instead of running a real organize.
        org_cache_rules(msg)
        do_organize(msg, true)
    elseif msg.cmd == 'localconsolidate' then
        do_local_consolidate(msg.bags)
    elseif msg.cmd == 'autosort' then
        autosort_bags = {}
        autosort_sig = {}
        if type(msg.bags) == 'table' then
            for _, b in ipairs(msg.bags) do local n = tonumber(b); if n then autosort_bags[n] = true end end
        end
    elseif msg.cmd == 'sortbag' then
        local list = {}
        if msg.bag ~= nil then list[1] = msg.bag
        elseif type(msg.bags) == 'table' then list = msg.bags end
        local n = 0
        for _, b in ipairs(list) do
            local bag = tonumber(b)
            local info = bag and windower.ffxi.get_bag_info(bag)
            if info and info.enabled then n = n + 1 end
        end
        if n > 0 then
            alex_chat(207, '[Alexandria] sorting ' .. n .. ' bag' .. (n == 1 and '' or 's') .. '...', 'action')
            sort_bags_staggered(list)
        else
            alex_chat(207, '[Alexandria] sort: no reachable bags (stand at a Mog House for storage bags)', 'progress')
        end
    elseif msg.cmd == 'lot' and msg.index ~= nil then
        enqueue_pool(tonumber(msg.index), 'lot')
    elseif msg.cmd == 'pass' and msg.index ~= nil then
        enqueue_pool(tonumber(msg.index), 'pass')
    elseif msg.cmd == 'lotall' then
        local party = windower.ffxi.get_party()
        local lots = party and party.p0 and party.p0.lots
        for i = 0, 9 do
            if pool[i] and not (lots and type(lots[i]) == 'number') then
                enqueue_pool(i, 'lot')
            end
        end
    elseif msg.cmd == 'passall' then
        for i = 0, 9 do
            if pool[i] then
                enqueue_pool(i, 'pass')
            end
        end
    elseif msg.cmd == 'passdone' then
        local party = windower.ffxi.get_party()
        local lots = party and party.p0 and party.p0.lots
        for i = 0, 9 do
            if pool[i] and not (lots and type(lots[i]) == 'number') then
                enqueue_pool(i, 'pass')
            end
        end
    elseif msg.cmd == 'poolrules' then
        pool_rules.lot = ids_for_names(msg.lot)
        pool_rules.pass = ids_for_names(msg.pass)
        pool_rules.drop = ids_for_names(msg.drop)
        pool_lotqty = idqty_for_names(msg.lotqty)
        pool_pass_on_lot = msg.passOnLot and true or false
        pool_autolot_on = msg.autoLot ~= false
        for idx, it in pairs(pool) do if it and it.id then pool_check(idx, it.id) end end
    elseif msg.cmd == 'tradenpc' then
        local id = resolve_item_id(msg)
        if id then
            local times = math.max(1, math.min(tonumber(msg.times) or 1, 30))
            local tid = msg.target_id and tonumber(msg.target_id) or nil
            local tix = msg.target_index and tonumber(msg.target_index) or nil
            for _ = 1, times do do_trade_npc(id, tid, tix, tonumber(msg.count)) end
            alex_chat(207, '[Alexandria] NPC trade x' .. times .. ' queued', 'action')
        end
    elseif msg.cmd == 'tradepc' then
        local id = resolve_item_id(msg)
        if id then do_trade_pc(id, tonumber(msg.count)) end
    elseif msg.cmd == 'tradepcoffer' and type(msg.items) == 'table' then
        do_trade_pc_offer(msg.target, msg.items)
    elseif msg.cmd == 'augcape' then
        aug_cape_start(msg.job, msg.material, msg.path, msg.repeats, msg.bag, msg.slot, msg.confirm_mode)
    elseif msg.cmd == 'augcapeseq' then
        aug_cape_seq_start(msg.job, msg.bag, msg.slot, msg.steps, msg.confirm_mode)
    elseif msg.cmd == 'auggear' then
        aug_gear_start(msg)
    elseif msg.cmd == 'auginfo' then
        aug_cape_info(msg.job, msg.material)
    elseif msg.cmd == 'augstop' then
        aug_stop()
    elseif msg.cmd == 'augkeep' then
        aug_manual_keep()
    elseif msg.cmd == 'augreroll' then
        aug_manual_reroll()
    elseif msg.cmd == 'augstep' then
        aug_step_continue()
    elseif msg.cmd == 'reforge' then
        rf_start(msg)
    elseif msg.cmd == 'reforgestop' then
        rf_stop()
    elseif msg.cmd == 'reforgestep' then
        rf_step_continue()
    elseif msg.cmd == 'reforgecollect' then
        rf_collect_start(msg)
    elseif msg.cmd == 'reforgepause' then
        rf_pause()
    elseif msg.cmd == 'reforgeresume' then
        rf_resume()
    elseif msg.cmd == 'remget' and msg.chapter ~= nil then
        rem_start(msg)
    elseif msg.cmd == 'remstop' then
        rem = nil
    elseif msg.cmd == 'bzopen' and msg.id and msg.index ~= nil then
        bz_open(tonumber(msg.id), tonumber(msg.index))
    elseif msg.cmd == 'bzrange' and msg.range ~= nil then
        bz_range = math.max(6, math.min(50, tonumber(msg.range) or 20))
        bz_sellers_dirty = true
    elseif msg.cmd == 'bzwatch' then
        bz_watching = msg.on and true or false
        if bz_watching then bz_sellers_dirty = true end
    elseif msg.cmd == 'bzscan' then
        bz_scan()
    elseif msg.cmd == 'bzdeepscan' then
        bz_deepscan()
    elseif msg.cmd == 'bzscanstop' then
        bz_sweep_stop()
    elseif msg.cmd == 'bzbuy' and msg.sellerid and msg.sellerindex ~= nil and msg.bidx ~= nil then
        bz_open(tonumber(msg.sellerid), tonumber(msg.sellerindex), { bidx = tonumber(msg.bidx), expect_id = tonumber(msg.id), expect_price = tonumber(msg.price), num = tonumber(msg.qty) or 1 })
    elseif msg.cmd == 'bzapply' and type(msg.items) == 'table' then
        bz_apply(msg.items)
    elseif msg.cmd == 'bzmessage' then
        bz_message(msg.text)
    elseif msg.cmd == 'bzclose' then
        bz_close()
    elseif msg.cmd == 'bzmy' then
        bz_my_dirty = true
    elseif msg.cmd == 'slipstore' and type(msg.ids) == 'table' then
        po_run_store(msg.ids)
    elseif msg.cmd == 'slipretrieve' and type(msg.ids) == 'table' then
        po_run_retrieve(msg.ids)
    elseif msg.cmd == 'alert' and msg.text then
        alex_chat(123, '[Alexandria] ' .. tostring(msg.text))
    elseif msg.cmd == 'droprules' then
        apply_droprules(msg.drop, msg.autodrop, tonumber(msg.delay))
    elseif msg.cmd == 'dropnow' then
        scan_drops()
    elseif msg.cmd == 'dropone' and msg.slot and msg.id then
        drop_request(tonumber(msg.slot), tonumber(msg.id), tonumber(msg.bag) or 0, msg.count and tonumber(msg.count) or nil)
    elseif msg.cmd == 'use' and msg.id then
        start_use_request(tonumber(msg.id), msg.all and true or false, tonumber(msg.bag) or 0, msg.slot and tonumber(msg.slot) or nil, msg.count and tonumber(msg.count) or nil)
    elseif msg.cmd == 'usestop' then
        if use_id then emit_use(false) end
        use_id = nil; use_left = 0; use_pending = nil
    elseif msg.cmd == 'store' and msg.npc and msg.id then
        store_enqueue(tostring(msg.npc), tonumber(msg.id), math.max(1, tonumber(msg.want) or 1), msg.drop and true or false)
    elseif msg.cmd == 'storeadd' and msg.npc and type(msg.zone) == 'number' and msg.id and msg.index ~= nil then
        -- A store NPC learned on another character; register it here too (fleet sync).
        local items = {}
        if type(msg.items) == 'table' then for _, iid in ipairs(msg.items) do local n = tonumber(iid); if n then items[#items + 1] = n end end end
        store_merge_entry(tostring(msg.npc), { zone = tonumber(msg.zone), id = tonumber(msg.id), index = tonumber(msg.index), items = items, batch = msg.batch and tonumber(msg.batch) or nil })
        store_dirty = true
    elseif msg.cmd == 'storestop' then
        store_q = {}
        store_finish()
    elseif msg.cmd == 'storedebug' then
        store_debug = msg.on and true or false
    elseif msg.cmd == 'experimental' then
        experimental_features = msg.on and true or false
        store_dirty = true
    elseif msg.cmd == 'silence' then
        silent_cat.action = msg.action and true or false
        silent_cat.progress = msg.progress and true or false
        silent_cat.error = msg.error and true or false
    elseif msg.cmd == 'retrieve' then
        do_retrieve(msg.items)
    elseif msg.cmd == 'dropclean' then
        do_drop_clean(msg.items)
    elseif msg.cmd == 'currency' then
        currency_request()
    elseif msg.cmd == 'dboxrefresh' then
        dbox_request_status()
    elseif msg.cmd == 'dboxopen' then
        dbox_open_box(msg.which == 'out' and 'out' or 'in', msg.cd)
    elseif msg.cmd == 'dboxclose' then
        dbox_close_box()
    elseif msg.cmd == 'dboxget' and type(msg.slots) == 'table' then
        dbox_get_batch(tonumber(msg.box) or 1, msg.slots)
    elseif msg.cmd == 'dboxtake' and type(msg.slots) == 'table' then
        dbox_take(msg.slots)
    elseif msg.cmd == 'dboxtakeall' then
        dbox_take_all()
    elseif msg.cmd == 'dboxreturn' and type(msg.slots) == 'table' then
        dbox_return(msg.slots)
    elseif msg.cmd == 'dboxsend' and msg.id and msg.target then
        dbox_send(tonumber(msg.bag) or 0, msg.slot and tonumber(msg.slot) or nil, tonumber(msg.id), tonumber(msg.count) or 1, tostring(msg.target))
    elseif msg.cmd == 'dboxsendmany' and type(msg.items) == 'table' then
        for _, it in ipairs(msg.items) do
            if it.id and it.target then dbox_send(tonumber(it.bag) or 0, it.slot and tonumber(it.slot) or nil, tonumber(it.id), tonumber(it.count) or 1, tostring(it.target)) end
        end
    elseif msg.cmd == 'dboxsendgil' and msg.target then
        dbox_send_gil(tonumber(msg.amount), tostring(msg.target))
    elseif msg.cmd == 'dboxcancel' then
        dbox_clear_queue()
    elseif msg.cmd == 'shopbuy' and msg.idx ~= nil then
        shop_buy_qty(tonumber(msg.idx), tonumber(msg.qty) or 1)
    elseif msg.cmd == 'shopsell' and msg.id then
        shop_sell_request(tonumber(msg.id), math.max(1, tonumber(msg.qty) or 1), tonumber(msg.bag) or 0, msg.slot and tonumber(msg.slot) or nil)
    elseif msg.cmd == 'shopsell_set' and type(msg.ids) == 'table' then
        shop_sell_list = {}
        for _, id in ipairs(msg.ids) do shop_sell_list[tonumber(id)] = true end
        shop_autosell = msg.auto and true or false
        sell_anywhere = msg.anywhere and true or false
        if sell_anywhere and in_town() then shop_sold = {}; shop_autosell_run() end
    elseif msg.cmd == 'npcselect' and msg.option ~= nil then
        npc_menu_select(tonumber(msg.option))
    elseif msg.cmd == 'trade' and msg.target then
        trade_begin(tostring(msg.target), msg.items, msg.gil, msg.id)
    elseif msg.cmd == 'tradewl_set' and type(msg.names) == 'table' then
        trade_wl = {}
        for _, nm in ipairs(msg.names) do if type(nm) == 'string' then trade_wl[nm] = true end end
        trade_wl_ids = {}
        if type(msg.ids) == 'table' then for _, i in ipairs(msg.ids) do local n = tonumber(i); if n then trade_wl_ids[n] = true end end end
    elseif msg.cmd == 'tradearm' and msg.from then
        trade_armed = { name = tostring(msg.from), id = tonumber(msg.fromId), t = os.clock() }
        if trade_debug then trade_log(('RX tradearm from=%s id=%s'):format(tostring(msg.from), tostring(msg.fromId))) end
    elseif msg.cmd == 'axecho' and msg.text then
        alex_chat(207, '[Alexandria] ' .. ax_colorize(tostring(msg.text)))
    elseif msg.cmd == 'memlog' then
        mem_log_on = msg.on and true or false
        local iv = tonumber(msg.interval)
        if iv and iv >= 30 then mem_log_interval = iv end
        if mem_log_on then mem_sample_t = 0 end
    elseif msg.cmd == 'currencybuy' and msg.shop and msg.item then
        cbuy_start(tostring(msg.shop), tonumber(msg.item), math.max(1, tonumber(msg.count) or 1))
    elseif msg.cmd == 'currencyfarm' and msg.shop and msg.item then
        cfarm_start(tostring(msg.shop), tonumber(msg.item), math.max(0, tonumber(msg.want) or 0))
    elseif msg.cmd == 'currencyfarmall' then
        cfarm_start_all(msg.shop and tostring(msg.shop) or nil, tonumber(msg.delay) or 0)
    elseif msg.cmd == 'farmstop' then
        cfarm = nil
        cbuy_release()
        emit_convert_off()
    elseif msg.cmd == 'shopnpc_set' and type(msg.names) == 'table' then
        npc_watch = {}
        for _, nm in ipairs(msg.names) do if type(nm) == 'string' then npc_watch[nm] = true end end
    elseif msg.cmd == 'resupply_set' then
        resupply_on = msg.on and true or false
        resupply_opts = {}
        for _, o in ipairs(msg.options or {}) do resupply_opts[#resupply_opts + 1] = tonumber(o) end
        resupply_min = {}
        local idx = build_name_index()
        for _, it in ipairs(msg.items or {}) do
            local id = it.id and tonumber(it.id) or (it.name and idx[tostring(it.name):lower()])
            local min = tonumber(it.min)
            if id and min and min > 0 then resupply_min[id] = min end
        end
        resupply_run = nil
        resupply_cd_npc = nil
    elseif msg.cmd == 'pvendor_set' then
        pvendor_on = msg.on and true or false
        pvendor_min = {}
        local idx = build_name_index()
        for _, it in ipairs(msg.items or {}) do
            local id = it.id and tonumber(it.id) or (it.name and idx[tostring(it.name):lower()])
            local min = tonumber(it.min)
            if id and min and min > 0 then pvendor_min[id] = min end
        end
        pvendor_run = nil
        pvendor_cd_npc = nil
    elseif msg.cmd == 'curioscan' then
        curio_scan_start()
    elseif msg.cmd == 'ahmenu' then
        -- NEVER fire the AH menu/status packet away from an auction house: the game answers with
        -- "auction house is temporarily closed for trading", which spams anyone standing in a normal zone
        -- with the Market view open. Just report we are not at an AH so the UI stops asking.
        if ah_usable() then
            ah_open_menu()
            ah_enqueue(function() return ah_request_status() end)
        else
            queue_send(build_ah())
        end
    elseif msg.cmd == 'ahslots' then
        if ah_usable() then
            ah_enqueue(function() return ah_request_status() end)
        else
            queue_send(build_ah())
        end
    elseif msg.cmd == 'ahbuy' and msg.id then
        if not ah_usable() then
            queue_send('{"t":"ahmsg","ok":false,"text":"Not at an auction house"}\n')
        else
            local id, single, price = tonumber(msg.id), (msg.single == 1 and 1 or 0), tonumber(msg.price) or 0
            local qty = math.max(1, math.min(7, tonumber(msg.qty) or 1))
            for _ = 1, qty do ah_enqueue(function() return ah_buy(id, single, price) end) end
        end
    elseif msg.cmd == 'ahsell' and msg.id then
        if not ah_usable() then
            queue_send('{"t":"ahmsg","ok":false,"text":"Not at an auction house"}\n')
        else
            local id, single, price = tonumber(msg.id), (msg.single == 1 and 1 or 0), tonumber(msg.price) or 0
            local qty = math.max(1, math.min(7, tonumber(msg.qty) or 1))
            local bag = tonumber(msg.bag) or 0
            local slot = tonumber(msg.slot)
            if bag ~= 0 and slot then
                local r = res.items[id]
                local ss = (r and r.stack) or 1
                local src = windower.ffxi.get_items(bag)
                local at = src and type(src) == 'table' and src[slot]
                local have = (type(at) == 'table' and at.id == id and at.id ~= 0 and at.count) or 0
                local listings, moveN
                if single == 1 then listings = math.min(qty, have); moveN = listings
                else listings = (have >= ss) and 1 or 0; moveN = ss end
                if not (type(at) == 'table' and at.id == id and at.id ~= 0) then
                    queue_send('{"t":"ahmsg","ok":false,"text":"Item no longer in that slot"}\n')
                elseif listings > 0 and moveN > 0 then
                    windower.ffxi.move_item(bag, 0, slot, moveN)
                    coroutine.schedule(function()
                        for _ = 1, listings do ah_enqueue(function() return ah_sell(id, single, price) end) end
                    end, 2.0)
                else
                    queue_send('{"t":"ahmsg","ok":false,"text":"Not enough of that item to list"}\n')
                end
            else
                for _ = 1, qty do ah_enqueue(function() return ah_sell(id, single, price) end) end
            end
        end
    elseif msg.cmd == 'ahclearslot' and msg.slot ~= nil then
        local s = tonumber(msg.slot)
        ah_enqueue(function() return ah_clear_slot(s) end)
    elseif msg.cmd == 'ahcancel' and msg.slot ~= nil then
        if not ah_usable() then
            queue_send('{"t":"ahmsg","ok":false,"text":"Not at an auction house"}\n')
        else
            local s = tonumber(msg.slot)
            ah_enqueue(function() return ah_cancel_slot(s) end)
        end
    elseif msg.cmd == 'ahcatalog' then
        ah_start_catalog()
    elseif msg.cmd == 'iconreq' and type(msg.ids) == 'table' then
        ah_queue_icons(msg.ids)
    elseif msg.cmd == 'iconall' then
        ah_extract_all_icons()
    elseif msg.cmd == 'ahclearsold' then
        if ah_box then
            for s = 0, 6 do
                if ah_box[s] and (ah_box[s].status == 'Sold' or ah_box[s].status == 'Not Sold') then
                    local slot = s
                    ah_enqueue(function() return ah_clear_slot(slot) end)
                end
            end
        end
    elseif msg.cmd == 'sync' then
        inv_dirty = true
        inv_dirty_at = os.clock() - INV_DEBOUNCE
        pool_dirty = true
        pool_dirty_at = os.clock() - INV_DEBOUNCE
        ki_dirty = true
        ki_dirty_at = os.clock() - 1.0
        porter_near_dirty = true
        vendor_near_dirty = true
        if cfarm_progress then cfarm_dirty = true end
    end
    if msg.seq then
        local sq = tonumber(msg.seq) or 0
        act_queue[#act_queue + 1] = function() queue_send('{"t":"seqack","seq":' .. sq .. ',"ok":true}\n') end
    end
end

local function finish_connect(s)
    s:settimeout(0)
    conn = s
    connected = true
    retry_delay = RETRY_INTERVAL
    queue_send(build_self('hello'))
    last_send = os.clock()
    -- Clear the change-dedup signatures so a fresh (re)connection ALWAYS resends the current inventory +
    -- key items, even when nothing changed since the last send. Without this a reconnect to an unchanged
    -- character stays blank on the desktop until the next inventory change (a trade) -- Nagumo's report.
    inv_sig_last = ''
    ki_last = ''
    inv_dirty = true
    inv_dirty_at = os.clock() - INV_DEBOUNCE
    pool_dirty = true
    pool_dirty_at = os.clock() - INV_DEBOUNCE
    slips_dirty = true
    slips_dirty_at = os.clock() - 1.0
    ki_dirty = true
    ki_dirty_at = os.clock() - 1.0
    ah_dirty = true
    store_dirty = true
    party_key = nil
    party_check_t = 0
end

local function bump_backoff()
    retry_delay = math.min(retry_delay * 1.5, RETRY_MAX)
end

local function try_connect()
    local s = socket.tcp()
    if not s then return end
    s:settimeout(0)
    local ok, err = s:connect(HOST, PORT)
    if ok then
        finish_connect(s)
    elseif err == 'timeout' or err == 'Operation already in progress' or err == 'Operation now in progress' then
        conn_pending = s
        conn_pending_t = os.clock()
    else
        pcall(function() s:close() end)
        bump_backoff()
    end
end

local function poll_pending_connect(now)
    if not conn_pending then return end
    local s = conn_pending
    local _, wt = socket.select({}, {s}, 0)
    if wt and wt[s] then
        conn_pending = nil
        if s:getpeername() then
            finish_connect(s)
        else
            pcall(function() s:close() end)
            bump_backoff()
        end
    elseif now - conn_pending_t > CONN_TIMEOUT then
        conn_pending = nil
        pcall(function() s:close() end)
        bump_backoff()
    end
end

-- Sage master-overlay fan-out (parallel to the primary Alexandria-app connection). Non-blocking; a 50ms connect
-- attempt every SAGE_RETRY is negligible when Sage is not running. Inbound lines run through the SAME socket-
-- agnostic dispatch(), so pool lot/pass/lotall/droprules driven from Sage's overlay behave exactly like ours.
function sage_disconnect()
    if sage_conn then pcall(function() sage_conn:close() end) end
    sage_conn = nil; sage_connected = false; sage_rx = ''; sage_txbuf = ''
end

function sage_try_connect()
    local s = socket.tcp()
    if not s then return end
    s:settimeout(0.05)
    local ok = s:connect(SAGE_HOST, SAGE_PORT)
    if ok then
        s:settimeout(0)
        sage_conn = s
        sage_connected = true
        local me = windower.ffxi.get_player()
        sage_txbuf = '{"t":"hello","app":"alexandria","char":"' .. esc((me and me.name) or '') .. '"}\n'
        pool_dirty = true
        pool_dirty_at = os.clock() - INV_DEBOUNCE   -- push the current pool to Sage promptly
    else
        pcall(function() s:close() end)
    end
end

function sage_tick(now)
    if not sage_connected then
        if (now - sage_last_try) >= SAGE_RETRY then sage_last_try = now; sage_try_connect() end
        return
    end
    local chunk, err, partial = sage_conn:receive('*a')
    local data = chunk or partial
    if data and #data > 0 then
        sage_rx = sage_rx .. data
        while true do
            local nl = sage_rx:find('\n', 1, true)
            if not nl then break end
            local line = sage_rx:sub(1, nl - 1)
            sage_rx = sage_rx:sub(nl + 1)
            if #line > 0 then dispatch(line) end
        end
        if #sage_rx > TXBUF_MAX then sage_rx = '' end
    end
    if err == 'closed' then sage_disconnect(); return end
    if #sage_txbuf > 0 then
        local sent, serr, last = sage_conn:send(sage_txbuf)
        local n = sent or last
        if n and n > 0 then sage_txbuf = sage_txbuf:sub(n + 1) end
        if serr == 'closed' then sage_disconnect(); return end
    end
end

do
    local jobToCapeMap = {
        ['war'] = "Cichol's Mantle", ['mnk'] = "Segomo's Mantle", ['whm'] = "Alaunus's Cape",
        ['blm'] = "Taranus's Cape", ['rdm'] = "Sucellos's Cape", ['thf'] = "Toutatis's Cape",
        ['pld'] = "Rudianos's Mantle", ['drk'] = "Ankou's Mantle", ['bst'] = "Artio's Mantle",
        ['brd'] = "Intarabus's Cape", ['rng'] = "Belenus's Cape", ['sam'] = "Smertrios's Mantle",
        ['nin'] = "Andartia's Mantle", ['drg'] = "Brigantia's Mantle", ['smn'] = "Campestres's Cape",
        ['blu'] = "Rosmerta's Cape", ['cor'] = "Camulus's Mantle", ['pup'] = "Visucius's Mantle",
        ['dnc'] = "Senuna's Mantle", ['sch'] = "Lugh's Cape", ['geo'] = "Nantosuelta's Cape",
        ['run'] = "Ogma's cape",
    }
    local allAugPaths = {
        ['abdhaljs thread'] = { [0]='HP', [1]='MP', [2]='STR', [3]='DEX', [4]='VIT', [5]='AGI', [6]='INT', [7]='MND', [8]='CHR', [9]='PetMelee', [10]='PetMagic' },
        ['abdhaljs dust'] = { [0]='Acc/Atk', [1]='RAcc/RAtk', [2]='MAcc/MDmg', [3]='Eva/MEva' },
        ['abdhaljs sap'] = { [0]='WSD', [1]='CritRate', [2]='STP', [3]='DoubleAttack', [4]='Haste', [5]='DW', [6]='Enmity+', [7]='Enmity-', [8]='Snapshot', [9]='MAB', [10]='FC', [11]='CurePotency', [12]='WaltzPotency', [13]='PetRegen', [14]='PetHaste' },
        ['abdhaljs dye'] = { [0]='HP', [1]='MP', [2]='STR', [3]='DEX', [4]='VIT', [5]='AGI', [6]='INT', [7]='MND', [8]='CHR', [9]='Acc', [10]='Atk', [11]='Racc', [12]='Ratk', [13]='MAcc', [14]='MDmg', [15]='Eva', [16]='MEva', [17]='PetAcc', [18]='PetAtk', [19]='PetMAcc', [20]='PetMDmg' },
        ['abdhaljs resin'] = { [0]='DEF', [1]='EvaR', [2]='MEvaR', [3]='PDT', [4]='MDT', [5]='DT', [6]='Regen', [7]='Counter', [8]='BlockRate', [9]='ParryRate', [10]='ResistAll', [11]='CastInt', [12]='PetPDT', [13]='PetMDT', [14]='PetDT', [15]='PetRegenR' },
    }
    local gear_style_types = {
        [0]={"Melee","Magic","Techniques"}, [1]={"Melee","Magic","Techniques"}, [2]={"Melee","Magic","Techniques"},
        [3]={"Melee","Magic","Techniques"}, [4]={"Melee","Magic","Techniques"}, [5]={"Melee","Familiar","Techniques"},
        [6]={"Melee","Familiar","Techniques"}, [7]={"Melee","Familiar","Techniques"}, [8]={"Melee","Familiar","Techniques"},
        [9]={"Melee","Familiar","Techniques"}, [10]={"Melee","Ranged","Magic","Familiar","Techniques"}, [11]={"Melee","Ranged","Magic","Familiar","Techniques"},
        [12]={"Melee","Ranged","Magic","Familiar","Techniques"}, [13]={"Melee","Ranged","Magic","Familiar","Techniques"}, [14]={"Melee","Ranged","Magic","Familiar","Techniques"},
        [15]={"Magic","Familiar","Techniques"}, [16]={"Magic","Familiar","Techniques"}, [17]={"Magic","Familiar","Techniques"},
        [18]={"Magic","Familiar","Techniques"}, [19]={"Magic","Familiar","Techniques"}, [20]={"Melee","Healing","Techniques"},
        [21]={"Melee","Healing","Techniques"}, [22]={"Melee","Healing","Techniques"}, [23]={"Melee","Healing","Techniques"},
        [24]={"Melee","Healing","Techniques"}, [25]={"Melee","Familiar","Techniques"}, [26]={"Melee","Magic","Techniques"},
        [27]={"Melee","Magic","Techniques"}, [28]={"Melee","Techniques"}, [29]={"Melee","Familiar","Techniques"},
        [30]={"Melee","Techniques"}, [31]={"Melee","Techniques"}, [32]={"Melee","Techniques"}, [33]={"Melee","Techniques"},
        [34]={"Melee","Techniques"}, [35]={"Melee","Magic","Techniques"}, [36]={"Magic","Familiar","Techniques"},
        [37]={"Ranged","Techniques"}, [38]={"Ranged","Techniques"},
    }
    local stone_types = { ["Pellucid Stone"]=0x0000, ["Fern Stone"]=0x0001, ["Taupe Stone"]=0x0002, ["Dark Matter"]=0x0003 }
    local style_types = { ["Melee"]=0x0008, ["Ranged"]=0x0108, ["Magic"]=0x0208, ["Familiar"]=0x0308, ["Healing"]=0x0408, ["Techniques"]=0x050A }
    local augment_values = {
        [-1]={{stat="unknown",offset=0}}, [0x000]={{stat="none",offset=0}},
        [0x001]={{stat="HP",offset=1}}, [0x002]={{stat="HP",offset=33}}, [0x003]={{stat="HP",offset=65}}, [0x004]={{stat="HP",offset=97}},
        [0x005]={{stat="HP",offset=1,multiplier=-1}}, [0x006]={{stat="HP",offset=33,multiplier=-1}}, [0x007]={{stat="HP",offset=65,multiplier=-1}}, [0x008]={{stat="HP",offset=97,multiplier=-1}},
        [0x009]={{stat="MP",offset=1}}, [0x00A]={{stat="MP",offset=33}}, [0x00B]={{stat="MP",offset=65}}, [0x00C]={{stat="MP",offset=97}},
        [0x00D]={{stat="MP",offset=1,multiplier=-1}}, [0x00E]={{stat="MP",offset=33,multiplier=-1}}, [0x00F]={{stat="MP",offset=65,multiplier=-1}}, [0x010]={{stat="MP",offset=97,multiplier=-1}},
        [0x011]={{stat="HP",offset=1},{stat="MP",offset=1}}, [0x012]={{stat="HP",offset=33},{stat="MP",offset=33}},
        [0x013]={{stat="HP",offset=1},{stat="MP",offset=1,multiplier=-1}}, [0x014]={{stat="HP",offset=33},{stat="MP",offset=33,multiplier=-1}},
        [0x015]={{stat="HP",offset=1,multiplier=-1},{stat="MP",offset=1}}, [0x016]={{stat="HP",offset=33,multiplier=-1},{stat="MP",offset=33}},
        [0x017]={{stat="Accuracy",offset=1}}, [0x018]={{stat="Accuracy",offset=1,multiplier=-1}},
        [0x019]={{stat="Attack",offset=1}}, [0x01A]={{stat="Attack",offset=1,multiplier=-1}},
        [0x01B]={{stat="Ranged Accuracy",offset=1}}, [0x01C]={{stat="Ranged Accuracy",offset=1,multiplier=-1}},
        [0x01D]={{stat="Ranged Attack",offset=1}}, [0x01E]={{stat="Ranged Attack",offset=1,multiplier=-1}},
        [0x01F]={{stat="Evasion",offset=1}}, [0x020]={{stat="Evasion",offset=1,multiplier=-1}},
        [0x021]={{stat="DEF",offset=1}}, [0x022]={{stat="DEF",offset=1,multiplier=-1}},
        [0x023]={{stat="Magic Accuracy",offset=1}}, [0x024]={{stat="Magic Accuracy",offset=1,multiplier=-1}},
        [0x025]={{stat="Magic Evasion",offset=1}}, [0x026]={{stat="Magic Evasion",offset=1,multiplier=-1}},
        [0x027]={{stat="Enmity",offset=1}}, [0x028]={{stat="Enmity",offset=1,multiplier=-1}},
        [0x029]={{stat="Critical hit rate",offset=1}}, [0x02A]={{stat="Enemy critical hit rate",offset=1,multiplier=-1}},
        [0x02B]={{stat='Charm',offset=1}}, [0x02C]={{stat='Store TP',offset=1},{stat='Subtle Blow',offset=1}},
        [0x02D]={{stat="DMG",offset=1}}, [0x02E]={{stat="DMG",offset=1,multiplier=-1}},
        [0x02F]={{stat="Delay",offset=1,percent=true}}, [0x030]={{stat="Delay",offset=1,multiplier=-1,percent=true}},
        [0x031]={{stat="Haste",offset=1}}, [0x032]={{stat='Slow',offset=1}},
        [0x033]={{stat="HP recovered while healing",offset=1}}, [0x034]={{stat="MP recovered while healing",offset=1}},
        [0x035]={{stat="Spell interruption rate down",offset=1,multiplier=-1,percent=true}},
        [0x036]={{stat="Physical damage taken",offset=1,multiplier=-1,percent=true}},
        [0x037]={{stat="Magic damage taken",offset=1,multiplier=-1,percent=true}},
        [0x038]={{stat="Breath damage taken",offset=1,multiplier=-1,percent=true}},
        [0x039]={{stat="Magic critical hit rate",offset=1}}, [0x03A]={{stat='Magic Defense Bonus',offset=1,multiplier=-1}},
        [0x03B]={{stat='Latent effect: Regain',offset=1}}, [0x03C]={{stat='Latent effect: Refresh',offset=1}},
        [0x03D]={{stat="Occ. inc. resist. to stat. ailments",offset=1}},
        [0x03E]={{stat="Accuracy",offset=33}}, [0x03F]={{stat="Ranged Accuracy",offset=33}}, [0x040]={{stat="Magic Accuracy",offset=33}},
        [0x041]={{stat="Attack",offset=33}}, [0x042]={{stat="Ranged Attack",offset=33}}, [0x043]={{stat="All Songs",offset=1}},
        [0x044]={{stat="Accuracy",offset=1},{stat="Attack",offset=1}}, [0x045]={{stat="Ranged Accuracy",offset=1},{stat="Ranged Attack",offset=1}},
        [0x046]={{stat="Magic Accuracy",offset=1},{stat='Magic Attack Bonus',offset=1}},
        [0x047]={{stat="Damage taken",offset=1,multiplier=-1,percent=true}},
        [0x04A]={{stat="Cap. Point",offset=1,percent=true}}, [0x04B]={{stat="Cap. Point",offset=33,percent=true}},
        [0x04C]={{stat="DMG",offset=33}}, [0x04D]={{stat="Delay",offset=33,multiplier=-1,percent=true}},
        [0x04E]={{stat="HP",offset=1,multiplier=2}}, [0x04F]={{stat="HP",offset=1,multiplier=3}},
        [0x050]={{stat="Magic Accuracy",offset=1},{stat="Magic Damage",offset=1}}, [0x051]={{stat="Evasion",offset=1},{stat="Magic Evasion",offset=1}},
        [0x052]={{stat="MP",offset=1,multiplier=2}}, [0x053]={{stat="MP",offset=1,multiplier=3}},
        [0x060]={{stat="Pet: Accuracy",offset=1},{stat="Pet: Ranged Accuracy",offset=1}}, [0x061]={{stat="Pet: Attack",offset=1},{stat="Pet: Ranged Attack",offset=1}},
        [0x062]={{stat="Pet: Evasion",offset=1}}, [0x063]={{stat="Pet: DEF",offset=1}}, [0x064]={{stat="Pet: Magic Accuracy",offset=1}},
        [0x065]={{stat='Pet: Magic Attack Bonus',offset=1}}, [0x066]={{stat="Pet: Critical Hit Rate",offset=1}},
        [0x067]={{stat="Pet: Enemy Critical Hit Rate",offset=1,multiplier=-1}}, [0x068]={{stat="Pet: Enmity",offset=1}}, [0x069]={{stat="Pet: Enmity",offset=1,multiplier=-1}},
        [0x06A]={{stat="Pet: Accuracy",offset=1},{stat="Pet: Ranged Accuracy",offset=1}}, [0x06B]={{stat="Pet: Attack",offset=1},{stat="Pet: Ranged Attack",offset=1}},
        [0x06C]={{stat="Pet: Magic Accuracy",offset=1},{stat='Pet: Magic Attack Bonus',offset=1}}, [0x06D]={{stat='Pet: Double Attack',offset=1},{stat="Pet: Critical Hit Rate",offset=1}},
        [0x06E]={{stat='Pet: Regen',offset=1}}, [0x06F]={{stat="Pet: Haste",offset=1}},
        [0x070]={{stat="Pet: Damage Taken",offset=1,multiplier=-1,percent=true}}, [0x071]={{stat="Pet: Ranged Accuracy",offset=1}}, [0x072]={{stat="Pet: Ranged Attack",offset=1}},
        [0x073]={{stat='Pet: Store TP',offset=1}}, [0x074]={{stat='Pet: Subtle Blow',offset=1}}, [0x075]={{stat="Pet: Magic Evasion",offset=1}},
        [0x076]={{stat="Pet: Physical Damage Taken",offset=1,multiplier=-1,percent=true}}, [0x077]={{stat='Pet: Magic Defense Bonus',offset=1}},
        [0x078]={{stat='Avatar: Magic Attack Bonus',offset=1}}, [0x079]={{stat='Pet: Breath',offset=1}}, [0x07A]={{stat='Pet: TP Bonus',offset=1,multiplier=20}}, [0x07B]={{stat='Pet: Double Attack',offset=1}},
        [0x07C]={{stat="Pet: Accuracy",offset=1},{stat="Pet: Ranged Accuracy",offset=1},{stat="Pet: Attack",offset=1},{stat="Pet: Ranged Attack",offset=1}},
        [0x07D]={{stat="Pet: Magic Accuracy",offset=1},{stat="Pet: Magic Damage",offset=1}}, [0x07E]={{stat='Pet: Magic Damage',offset=1}},
        [0x080]={{stat="Pet:",offset=0}}, [0x085]={{stat='Magic Attack Bonus',offset=1}}, [0x086]={{stat='Magic Defense Bonus',offset=1}}, [0x087]={{stat="Avatar:",offset=0}},
        [0x089]={{stat="Regen",offset=1}}, [0x08A]={{stat="Refresh",offset=1}}, [0x08B]={{stat="Rapid Shot",offset=1}}, [0x08C]={{stat="Fast Cast",offset=1}},
        [0x08D]={{stat="Conserve MP",offset=1}}, [0x08E]={{stat="Store TP",offset=1}}, [0x08F]={{stat="Double Attack",offset=1}}, [0x090]={{stat="Triple Attack",offset=1}},
        [0x091]={{stat="Counter",offset=1}}, [0x092]={{stat="Dual Wield",offset=1}}, [0x093]={{stat="Treasure Hunter",offset=1}}, [0x094]={{stat="Gilfinder",offset=1}},
        [0x097]={{stat='Martial Arts',offset=1}}, [0x099]={{stat='Shield Mastery',offset=1}},
        [0x0B0]={{stat='Resist Sleep',offset=1}}, [0x0B1]={{stat='Resist Poison',offset=1}}, [0x0B2]={{stat='Resist Paralyze',offset=1}}, [0x0B3]={{stat='Resist Blind',offset=1}},
        [0x0B4]={{stat='Resist Silence',offset=1}}, [0x0B5]={{stat='Resist Petrify',offset=1}}, [0x0B6]={{stat='Resist Virus',offset=1}}, [0x0B7]={{stat='Resist Curse',offset=1}},
        [0x0B8]={{stat='Resist Stun',offset=1}}, [0x0B9]={{stat='Resist Bind',offset=1}}, [0x0BA]={{stat='Resist Gravity',offset=1}}, [0x0BB]={{stat='Resist Slow',offset=1}}, [0x0BC]={{stat='Resist Charm',offset=1}},
        [0x0C2]={{stat='Kick Attacks',offset=1}}, [0x0C3]={{stat='Subtle Blow',offset=1}}, [0x0C6]={{stat='Zanshin',offset=1}},
        [0x0D3]={{stat='Snapshot',offset=1}}, [0x0D4]={{stat='Recycle',offset=1}}, [0x0D7]={{stat='Ninja Tool Expertise',offset=1}},
        [0x0E9]={{stat='Blood Boon',offset=1}}, [0x0ED]={{stat='Occult Acumen',offset=1}},
        [0x101]={{stat="Hand-to-Hand skill",offset=1}}, [0x102]={{stat="Dagger skill",offset=1}}, [0x103]={{stat="Sword skill",offset=1}}, [0x104]={{stat="Great Sword skill",offset=1}},
        [0x105]={{stat="Axe skill",offset=1}}, [0x106]={{stat="Great Axe skill",offset=1}}, [0x107]={{stat="Scythe skill",offset=1}}, [0x108]={{stat="Polearm skill",offset=1}},
        [0x109]={{stat="Katana skill",offset=1}}, [0x10A]={{stat="Great Katana skill",offset=1}}, [0x10B]={{stat="Club skill",offset=1}}, [0x10C]={{stat="Staff skill",offset=1}},
        [0x116]={{stat="Melee skill",offset=1}}, [0x117]={{stat="Ranged skill",offset=1}}, [0x118]={{stat="Magic skill",offset=1}}, [0x119]={{stat="Archery skill",offset=1}},
        [0x11A]={{stat="Marksmanship skill",offset=1}}, [0x11B]={{stat="Throwing skill",offset=1}}, [0x11E]={{stat="Shield skill",offset=1}}, [0x120]={{stat="Divine magic skill",offset=1}},
        [0x121]={{stat="Healing magic skill",offset=1}}, [0x122]={{stat="Enhancing magic skill",offset=1}}, [0x123]={{stat="Enfeebling magic skill",offset=1}}, [0x124]={{stat="Elemental magic skill",offset=1}},
        [0x125]={{stat="Dark magic skill",offset=1}}, [0x126]={{stat="Summoning magic skill",offset=1}}, [0x127]={{stat="Ninjutsu skill",offset=1}}, [0x128]={{stat="Singing skill",offset=1}},
        [0x129]={{stat="String instrument skill",offset=1}}, [0x12A]={{stat="Wind instrument skill",offset=1}}, [0x12B]={{stat="Blue Magic skill",offset=1}}, [0x12C]={{stat="Geomancy Skill",offset=1}}, [0x12D]={{stat="Handbell Skill",offset=1}},
        [0x140]={{stat='Blood Pact ability delay',offset=1,multiplier=-1}}, [0x141]={{stat='Avatar perpetuation cost',offset=1,multiplier=-1}},
        [0x142]={{stat="Song spellcasting time",offset=1,multiplier=-1,percent=true}}, [0x143]={{stat='Cure spellcasting time',offset=1,multiplier=-1,percent=true}},
        [0x144]={{stat='Call Beast ability delay',offset=1,multiplier=-1}}, [0x145]={{stat='Quick Draw ability delay',offset=1,multiplier=-1}},
        [0x146]={{stat="Weapon Skill Accuracy",offset=1}}, [0x147]={{stat="Weapon skill damage",offset=1,percent=true}}, [0x148]={{stat="Critical hit damage",offset=1,percent=true}},
        [0x149]={{stat='Cure potency',offset=1,percent=true}}, [0x14A]={{stat='Waltz potency',offset=1,percent=true}}, [0x14B]={{stat='Waltz ability delay',offset=1,multiplier=-1}},
        [0x14C]={{stat="Skillchain Damage",offset=1,percent=true}}, [0x14D]={{stat='Conserve TP',offset=1}}, [0x14E]={{stat="Magic Burst Damage",offset=1,percent=true}}, [0x14F]={{stat="Magic Critical Hit Damage",offset=1,percent=true}},
        [0x150]={{stat='Sic and Ready ability delay',offset=1,multiplier=-1}}, [0x151]={{stat="Song recast delay",offset=1,multiplier=-1}}, [0x152]={{stat='Barrage',offset=1}}, [0x153]={{stat='Elemental Siphon',offset=1,multiplier=5}},
        [0x154]={{stat='Phantom Roll ability delay',offset=1,multiplier=-1}}, [0x155]={{stat='Repair potency',offset=1,percent=true}}, [0x156]={{stat='Waltz TP cost',offset=1,multiplier=-1}}, [0x157]={{stat='Drain and Aspir potency',offset=1}},
        [0x15E]={{stat="Occ. maximizes magic accuracy",offset=1,percent=true}}, [0x15F]={{stat="Occ. quickens spellcasting",offset=1,percent=true}}, [0x160]={{stat="Occ. grants dmg. bonus based on TP",offset=1,percent=true}},
        [0x161]={{stat="TP Bonus",offset=1,multiplier=5}}, [0x162]={{stat="Quadruple Attack",offset=1}}, [0x164]={{stat='Potency of Cure effect received',offset=1,percent=true}}, [0x168]={{stat="Save TP",offset=1,multiplier=10}},
        [0x16A]={{stat="Magic Damage",offset=1}}, [0x16B]={{stat="Chance of successful block",offset=1}}, [0x16E]={{stat="Blood Pact ability delay II",offset=1,multiplier=-1}}, [0x170]={{stat="Phalanx",offset=1}},
        [0x171]={{stat="Blood Pact Damage",offset=1}}, [0x172]={{stat='Reverse Flourish',offset=1}}, [0x173]={{stat='Regen Potency',offset=1}}, [0x174]={{stat='Embolden',offset=1}},
        [0x200]={{stat="STR",offset=1}}, [0x201]={{stat="DEX",offset=1}}, [0x202]={{stat="VIT",offset=1}}, [0x203]={{stat="AGI",offset=1}}, [0x204]={{stat="INT",offset=1}}, [0x205]={{stat="MND",offset=1}}, [0x206]={{stat="CHR",offset=1}},
        [0x207]={{stat="STR",offset=1,multiplier=-1}}, [0x208]={{stat="DEX",offset=1,multiplier=-1}}, [0x209]={{stat="VIT",offset=1,multiplier=-1}}, [0x20A]={{stat="AGI",offset=1,multiplier=-1}}, [0x20B]={{stat="INT",offset=1,multiplier=-1}}, [0x20C]={{stat="MND",offset=1,multiplier=-1}}, [0x20D]={{stat="CHR",offset=1,multiplier=-1}},
        [0x226]={{stat="STR",offset=1},{stat="DEX",offset=1}}, [0x227]={{stat="STR",offset=1},{stat="VIT",offset=1}}, [0x228]={{stat="STR",offset=1},{stat="AGI",offset=1}}, [0x229]={{stat="DEX",offset=1},{stat="AGI",offset=1}},
        [0x22A]={{stat="INT",offset=1},{stat="MND",offset=1}}, [0x22B]={{stat="MND",offset=1},{stat="CHR",offset=1}}, [0x22C]={{stat="INT",offset=1},{stat="MND",offset=1},{stat="CHR",offset=1}}, [0x22D]={{stat="STR",offset=1},{stat="CHR",offset=1}}, [0x22E]={{stat="STR",offset=1},{stat="INT",offset=1}}, [0x22F]={{stat="STR",offset=1},{stat="MND",offset=1}},
        [0x2E4]={{stat="DMG",offset=1}}, [0x2E5]={{stat="DMG",offset=33}}, [0x2E6]={{stat="DMG",offset=65}}, [0x2E7]={{stat="DMG",offset=97}},
        [0x380]={{stat="Sword enhancement spell damage",offset=1}}, [0x381]={{stat='Enhances Souleater effect',offset=1,percent=true}},
        [0x480]={{stat="DEF",offset=1,multiplier=10}}, [0x481]={{stat="Evasion",offset=1,multiplier=3}}, [0x482]={{stat="Mag. Evasion",offset=1,multiplier=3}},
        [0x483]={{stat="Phys. dmg. taken",offset=1,multiplier=-2,percent=true}}, [0x484]={{stat="Magic dmg. taken",offset=1,multiplier=-2,percent=true}}, [0x485]={{stat="Spell interruption rate down",offset=1,multiplier=-2,percent=true}}, [0x486]={{stat="Occ. inc. resist. to stat. ailments",offset=1,multiplier=2}},
        [0x4E0]={{stat="Enh. Mag. eff. dur.",offset=1}}, [0x4E1]={{stat="Helix eff. dur.",offset=1}}, [0x4E2]={{stat="Indi. eff. dur.",offset=1}}, [0x4F0]={{stat="Meditate eff. dur.",offset=1}},
        [0x700]={{stat="Pet: STR",offset=1}}, [0x701]={{stat="Pet: DEX",offset=1}}, [0x702]={{stat="Pet: VIT",offset=1}}, [0x703]={{stat="Pet: AGI",offset=1}}, [0x704]={{stat="Pet: INT",offset=1}}, [0x705]={{stat="Pet: MND",offset=1}}, [0x706]={{stat="Pet: CHR",offset=1}},
    }

    local id_cache = nil
    local function res_id(name)
        if not name or name == '' then return nil end
        if not id_cache then
            id_cache = {}
            for iid, it in pairs(res.items) do
                if type(it) == 'table' then
                    if it.enl then id_cache[it.enl:lower()] = iid end
                    if it.en then id_cache[it.en:lower()] = iid end
                end
            end
        end
        return id_cache[tostring(name):lower()]
    end

    local function find_slot(item_id)
        local inv = windower.ffxi.get_items(0)
        if not inv then return nil end
        for s = 1, (inv.max or 80) do
            local it = inv[s]
            if type(it) == 'table' and it.id == item_id and it.id ~= 0 then return it.slot or s end
        end
        return nil
    end

    local function bag_find(item_id)
        for bag_id in pairs(res.bags) do
            if bag_id ~= 0 then
                local items = windower.ffxi.get_items(bag_id)
                if type(items) == 'table' and items.enabled then
                    local m = find_in_bag(bag_id, item_id, nil)
                    if m then return bag_id, m.slot, m.count end
                end
            end
        end
        return nil
    end

    local function count_in_bag(item_id, bag_id)
        local items = windower.ffxi.get_items(bag_id)
        local n = 0
        if type(items) == 'table' then
            for s = 1, (items.max or 0) do
                local it = items[s]
                if type(it) == 'table' and it.id == item_id and it.id ~= 0 then n = n + (it.count or 0) end
            end
        end
        return n
    end

    local function aug_src_bags()
        local b = { 5, 6, 7 }   -- satchel/sack/case: reachable anywhere, always fair game
        local info = windower.ffxi.get_info()
        if info and info.mog_house then
            b[#b + 1] = 1; b[#b + 1] = 2; b[#b + 1] = 4; b[#b + 1] = 9
        elseif info and info.zone and NOMAD_ZONES[info.zone] and (experimental_features or nomad_near) then
            -- Nomad Moogle bags (safe/locker/safe2). Being in a nomad ZONE (e.g. Norg) is not the same as
            -- standing AT the moogle, so honor the same contract as the rest of the app: zone-wide access
            -- only with experimental features ON; otherwise require physical proximity (nomad_near, <=6y).
            -- Without this, the augment path pulled Dark Matter from the Mog Locker across the zone with
            -- experimental OFF and the user nowhere near the moogle.
            b[#b + 1] = 1; b[#b + 1] = 4; b[#b + 1] = 9
        end
        return b
    end

    local function aug_pull_mat(mat_id, need)
        local src = aug_src_bags()
        local have = count_in_bag(mat_id, 0)
        if have >= need then return true, false end
        local other = 0
        for _, bg in ipairs(src) do other = other + count_in_bag(mat_id, bg) end
        if have + other < need then return false, false, have + other end
        local short = need - have
        for _, bg in ipairs(src) do
            if short <= 0 then break end
            local avail = count_in_bag(mat_id, bg)
            if avail > 0 then
                local take = math.min(avail, short)
                enqueue_move(mat_id, bg, 0, take)
                short = short - take
            end
        end
        return true, true
    end

    local function enqueue_move_slot(item_id, from_bag, slot, count)
        enqueue_fast(function()
            local di = windower.ffxi.get_bag_info(0)
            if di and (di.max - di.count) <= 0 then return end
            local items = windower.ffxi.get_items(from_bag)
            local it = items and type(items) == 'table' and items[slot]
            if type(it) == 'table' and it.id == item_id and it.id ~= 0 then
                windower.ffxi.move_item(from_bag, 0, it.slot or slot, it.count or count or 1)
            end
        end)
    end

    local function ready_status()
        local p = windower.ffxi.get_player()
        return p and p.status == 0
    end

    local function npc_in_range(npc_id)
        local m = windower.ffxi.get_mob_by_id(npc_id)
        if m and m.distance and math.sqrt(m.distance) <= 6 then return true end
        if not experimental_features then return false end
        local fx = aug and aug.npc_name and STORE_FIXED_NPCS[aug.npc_name]
        if fx and store_last_zone == fx.zone then return true end
        return false
    end

    local function read_cape_augs(cape_id, cape_slot)
        local out = { 'none', 'none', 'none', 'none', 'none' }
        if not extdata_ok or not cape_id then return out end
        local inv = windower.ffxi.get_items(0)
        if not inv then return out end
        local it
        if cape_slot then
            local x = inv[cape_slot]
            if type(x) == 'table' and x.id == cape_id and x.id ~= 0 then it = x end
        end
        if not it then
            for s = 1, (inv.max or 80) do
                local x = inv[s]
                if type(x) == 'table' and x.id == cape_id and x.id ~= 0 then it = x break end
            end
        end
        if it and it.extdata then
            local ok, dec = pcall(extdata.decode, it)
            if ok and dec and dec.augments then
                for i = 1, 5 do out[i] = dec.augments[i] or 'none' end
            end
        end
        return out
    end

    local function unpack_augment(short)
        return short:byte(1) + short:byte(2) % 8 * 256, math.floor(short:byte(2) / 8)
    end

    local function augments_to_table(str)
        local out = {}
        for i = 1, #str, 2 do
            if i + 1 <= #str then
                local aid, val = unpack_augment(str:sub(i, i + 1))
                local av = augment_values[aid]
                if av then out[#out + 1] = { aid, (val + av[1].offset) * (av[1].multiplier or 1) } end
            end
        end
        return out
    end

    local function get_augment_stats(aid)
        local ret = {}
        if aid > 0 and augment_values[aid] then
            for _, v in pairs(augment_values[aid]) do ret[#ret + 1] = v.stat:lower() end
        end
        return ret
    end

    local function decode_augment(str)
        local tab = augments_to_table(str:sub(3, 12))
        local out = {}
        for _, v in ipairs(tab) do
            for _, stat in ipairs(get_augment_stats(v[1])) do
                out[stat] = (out[stat] or 0) + v[2]
            end
        end
        return out
    end

    local function check_one(augment, value, results)
        if not augment or augment == '' then return false end
        if augment:find(' and ', 1, true) then
            local a, b = augment:match('^(.-) and (.+)$')
            if a and b and results[a] and results[b] then
                if math.abs(results[a]) >= value then return true end
            end
        end
        for k, v in pairs(results) do
            if k == augment and math.abs(v) >= value then return true end
        end
        return false
    end

    local function any_match(results)
        local a = aug
        local has1, has2, has3 = a.a1 ~= '', a.a2 ~= '', a.a3 ~= ''
        if not (has1 or has2 or has3) then return false end
        local c1 = has1 and check_one(a.a1, a.v1, results)
        local c2 = has2 and check_one(a.a2, a.v2, results)
        local c3 = has3 and check_one(a.a3, a.v3, results)
        if a.amode == 'or' then return (c1 or c2 or c3) and true or false end
        local ok = true
        if has1 then ok = ok and c1 end
        if has2 then ok = ok and c2 end
        if has3 then ok = ok and c3 end
        return ok and true or false
    end

    local function lc(v) return tostring(v or ''):lower() end

    -- Passive ambuscade augment diagnostics: append a per-day log under debug/ambuscade/ so a material
    -- loss (material spent but cape not augmented) can always be triaged after the fact. Observe-only;
    -- globals (not locals) to stay under the main-chunk 200-local cap.
    amb_dir_ready = false
    function amb_log(line)
        local base = windower.addon_path .. 'debug/ambuscade'
        if not amb_dir_ready then
            if windower.dir_exists and windower.create_dir then
                if not windower.dir_exists(windower.addon_path .. 'debug') then windower.create_dir(windower.addon_path .. 'debug') end
                if not windower.dir_exists(base) then windower.create_dir(base) end
            end
            amb_dir_ready = true
        end
        local ok, f = pcall(io.open, base .. '/' .. os.date('%Y-%m-%d') .. '.log', 'a')
        if ok and f then f:write(('[%s] %s\n'):format(os.date('%H:%M:%S'), line)); f:close() end
    end
    function aug_sig_str(sig)
        if type(sig) ~= 'table' then return '?' end
        local t = {}
        for i = 1, 5 do t[i] = tostring(sig[i] or 'none') end
        return table.concat(t, ' | ')
    end

    local function aug_fail(msg)
        aug = aug or {}
        if aug.mode == 'Ambuscade' then amb_log(('FAIL: %s | done=%s/%s sig=[%s]'):format(tostring(msg), tostring(aug.done), tostring(aug.total), aug_sig_str(aug.cape_sig))) end
        aug.mode = aug.mode or 'Augment'
        aug.active = false
        aug.status = msg
        aug_dirty = true
        alex_chat(207, '[Alexandria] augment: ' .. msg, 'progress')
    end

    -- Money-critical identity + verification for Ambuscade cape augmenting. Two capes of the same item
    -- id are told apart ONLY by their augment fingerprint (extdata); resolving by id alone augments the
    -- wrong (often blank) duplicate and silently burns expensive materials. Globals, not locals, to
    -- stay under Lua's 200 main-chunk local cap; they capture extdata/extdata_ok/lc as upvalues.

    -- Canonical per-slot augment token. A never-augmented cape decodes with NO augments table at all;
    -- nil / '' / 'none' all collapse to 'none' so a fresh 0-augment cape reads as a valid (empty)
    -- fingerprint instead of an unreadable one, while augmented duplicates still fingerprint distinctly.
    function aug_slot_token(a)
        a = lc(tostring(a or 'none'))
        if a == '' then a = 'none' end
        return a
    end

    function aug_cape_sig_at(bag, slot, cape_id)
        if not extdata_ok or not cape_id or not bag or not slot then return nil end
        local items = windower.ffxi.get_items(bag)
        local it = items and type(items) == 'table' and items[slot]
        if not (type(it) == 'table' and it.id == cape_id and it.id ~= 0 and it.extdata) then return nil end
        local ok, dec = pcall(extdata.decode, it)
        if not (ok and dec) then return nil end
        local s = {}
        for i = 1, 5 do s[i] = aug_slot_token(dec.augments and dec.augments[i]) end
        return s
    end

    -- Slot whose cape fingerprint equals sig exactly. Returns slot, matchCount (0 = not present).
    function aug_cape_find(cape_id, sig)
        if not extdata_ok or not sig then return nil, 0 end
        local inv = windower.ffxi.get_items(0)
        if not inv then return nil, 0 end
        local slot, n = nil, 0
        for s = 1, (inv.max or 80) do
            local it = inv[s]
            if type(it) == 'table' and it.id == cape_id and it.id ~= 0 and it.extdata then
                local ok, dec = pcall(extdata.decode, it)
                if ok and dec then
                    local same = true
                    for i = 1, 5 do if aug_slot_token(dec.augments and dec.augments[i]) ~= sig[i] then same = false break end end
                    if same then slot = it.slot or s; n = n + 1 end
                end
            end
        end
        return slot, n
    end

    -- After a roll our cape matches `sig` on every slot except `changed`, which must have advanced.
    -- Re-locates our exact cape even if it returned to a different inventory slot. Returns slot, newSig.
    function aug_cape_find_advanced(cape_id, sig, changed)
        if not extdata_ok or not sig then return nil end
        local inv = windower.ffxi.get_items(0)
        if not inv then return nil end
        for s = 1, (inv.max or 80) do
            local it = inv[s]
            if type(it) == 'table' and it.id == cape_id and it.id ~= 0 and it.extdata then
                local ok, dec = pcall(extdata.decode, it)
                if ok and dec then
                    local cur, good = {}, true
                    for i = 1, 5 do cur[i] = aug_slot_token(dec.augments and dec.augments[i]) end
                    for i = 1, 5 do
                        if i == changed then if cur[i] == sig[i] then good = false break end
                        elseif cur[i] ~= sig[i] then good = false break end
                    end
                    if good then return it.slot or s, cur end
                end
            end
        end
        return nil
    end

    local function cape_trade()
        -- Before trading (and burning) another material, confirm the PREVIOUS roll actually landed on
        -- OUR cape. If it did not advance, or the cape can't be found, stop cold -- the safety net that
        -- makes it impossible to silently burn a stack.
        if aug.verify_pending then
            local slot, cur = aug_cape_find_advanced(aug.cape_id, aug.cape_sig, aug.verify_slot)
            if slot then
                amb_log(('VERIFY landed | %s | [%s] -> [%s]'):format(tostring(aug.cape_material), aug_sig_str(aug.cape_sig), aug_sig_str(cur)))
                aug.cape_sig = cur; aug.cape_slot = slot; aug.verify_pending = false; aug.wait_since = nil
            else
                aug.wait_since = aug.wait_since or os.clock()
                if (os.clock() - aug.wait_since) > 12 then
                    local now_mat = count_in_bag(aug.mat_id, 0)
                    local spent = (aug.trade_mat_count or now_mat) - now_mat
                    amb_log(('VERIFY FAILED (12s) | %s slot did NOT advance | matAtTrade=%s matNow=%d spent=%d sig=[%s]%s'):format(
                        tostring(aug.cape_material), tostring(aug.trade_mat_count), now_mat, spent, aug_sig_str(aug.cape_sig),
                        spent > 0 and '  <<< MATERIAL LOST: spent but cape unchanged' or ''))
                    if aug_cape_find(aug.cape_id, aug.cape_sig) then
                        aug_fail(('augment did not apply (%s unchanged); stopped to protect materials'):format(aug.cape_material or '?'))
                    else
                        aug_fail('lost track of the cape after augmenting; stopped to protect materials')
                    end
                end
                return
            end
        end
        -- Resolve OUR exact cape by fingerprint -- never first-match by id.
        local ci = aug_cape_find(aug.cape_id, aug.cape_sig)
        if not ci then
            aug.wait_since = aug.wait_since or os.clock()
            if (os.clock() - aug.wait_since) > 12 then aug_fail('selected cape not found in inventory; stopped') end
            return
        end
        aug.wait_since = nil
        aug.cape_slot = ci
        local mi = find_slot(aug.mat_id)
        if not mi then aug_fail('material left inventory') return end
        aug.verify_slot = aug.mat_slot
        aug.trade_mat_count = count_in_bag(aug.mat_id, 0)
        amb_log(('TRADE roll %d/%d | mat=%s(%d) haveInInv=%d capeSlot=%d verifySlot=%s opt=%d sig=[%s]'):format(
            (aug.done or 0) + 1, aug.total or 1, tostring(aug.cape_material), aug.mat_id, aug.trade_mat_count, ci, tostring(aug.mat_slot), aug.first_time and 512 or 256, aug_sig_str(aug.cape_sig)))
        packets.inject(packets.new('outgoing', 0x036, {
            ['Target'] = aug.npc_id, ['Target Index'] = aug.npc_index,
            ['Item Count 1'] = 1, ['Item Count 2'] = 1,
            ['Item Index 1'] = ci, ['Item Index 2'] = mi, ['Number of Items'] = 2,
        }))
        aug.awaiting = true
        aug.verify_pending = true
        aug.last_progress = os.clock()   -- the response watchdog starts at THIS trade, not the prior one
    end

    local function cape_confirm()
        local opt = aug.first_time and 512 or 256
        aug.first_time = false
        local p = packets.new('outgoing', 0x05B, {
            ['Target'] = aug.npc_id, ['Option Index'] = opt, ['_unknown1'] = aug.path_index,
            ['Target Index'] = aug.npc_index, ['Automated Message'] = true,
            ['Zone'] = aug.zone, ['Menu ID'] = aug.menu or 0x183,
        })
        packets.inject(p)
        p['Automated Message'] = false
        packets.inject(p)
        local me = windower.ffxi.get_mob_by_target('me')
        if me then packets.inject(packets.new('outgoing', 0x016, { ['Target Index'] = me.index })) end
    end

    local function gear_trade(now)
        if not npc_in_range(aug.npc_id) then aug_fail(aug.npc_name .. ' out of range') return end
        local gi
        if aug.item_slot then
            local inv0 = windower.ffxi.get_items(0)
            local it = inv0 and type(inv0) == 'table' and inv0[aug.item_slot]
            if type(it) == 'table' and it.id == aug.item_id and it.id ~= 0 then gi = aug.item_slot end
        end
        if not gi then gi = find_slot(aug.item_id) end
        if not gi then
            -- The gear briefly leaves inventory during each reforge (traded out, augmented, then
            -- returned a moment later). Don't abort on that transient gap -- with a 0s delay the next
            -- trade can fire before the item is back. Wait for it, and only fail if it never returns.
            aug.gear_gone_since = aug.gear_gone_since or now
            if (now - aug.gear_gone_since) > 15 then aug_fail('gear left inventory') end
            return
        end
        aug.gear_gone_since = nil
        local fields
        if aug.mode == 'Geas Fete' and not aug.paid then
            -- free daily roll: trade the gear alone to open the roll menu
            fields = { ['Target'] = aug.npc_id, ['Target Index'] = aug.npc_index, ['Number of Items'] = 1, ['Item Count 1'] = 1, ['Item Index 1'] = gi }
        elseif aug.mode == 'Geas Fete' and aug.paid then
            -- paid roll: trade gear + one Dark Matter (result comes back as a 0x034)
            local mi = find_slot(aug.dm_id)
            if not mi then aug_fail('Dark Matter left inventory') return end
            fields = { ['Target'] = aug.npc_id, ['Target Index'] = aug.npc_index, ['Number of Items'] = 2, ['Item Count 1'] = 1, ['Item Index 1'] = gi, ['Item Count 2'] = 1, ['Item Index 2'] = mi }
            aug.dm_used = (aug.dm_used or 0) + 1
        else
            local mi = find_slot(aug.mat_id)
            if not mi then aug_fail('material left inventory') return end
            fields = { ['Target'] = aug.npc_id, ['Target Index'] = aug.npc_index, ['Number of Items'] = 2, ['Item Count 1'] = 1, ['Item Index 1'] = gi, ['Item Count 2'] = 1, ['Item Index 2'] = mi }
        end
        packets.inject(packets.new('outgoing', 0x036, fields))
        aug.last_trade = now
        aug.awaiting = true
    end

    local function reject_npc()
        packets.inject(packets.new('outgoing', 0x05B, {
            ['Target'] = aug.npc_id, ['Option Index'] = aug.reject_option, ['Target Index'] = aug.npc_index,
            ['Automated Message'] = false, ['Zone'] = aug.zone, ['Menu ID'] = aug.menu, ['_unknown1'] = aug.reject_unknown,
        }))
    end

    local function accept_npc()
        if not (aug and aug.results and any_match(aug.results)) then return reject_npc() end
        packets.inject(packets.new('outgoing', 0x05B, {
            ['Target'] = aug.npc_id, ['Option Index'] = aug.accept_option, ['Target Index'] = aug.npc_index,
            ['Automated Message'] = false, ['Zone'] = aug.zone, ['Menu ID'] = aug.menu,
        }))
    end

    -- Free daily rolls are used up: switch to the paid Dark Matter loop if budget + a stone remain
    -- (reject/close the menu so the gear returns; the tick then trades gear + Dark Matter), else give
    -- up and keep the previous augments. Global, not local, to stay under Lua's 200 main-chunk local
    -- limit; it captures the surrounding locals (aug, reject_npc, ...) as upvalues.
    function aug_start_paid(failmsg)
        if aug.stone == 'Dark Matter' and aug.dm_id and (aug.dm_used or 0) < (aug.dm_budget or 0) and count_in_bag(aug.dm_id, 0) >= 1 then
            aug.paid = true; aug.awaiting = false; pcall(reject_npc)
            aug.prep = true; aug.prep_deadline = os.clock() + 15; aug.last_trade = os.clock()
            aug.status = ('Dark Matter rolls (%d/%d)'):format(aug.dm_used or 0, aug.dm_budget or 0)
            aug_dirty = true
        else
            pcall(reject_npc); aug_fail(failmsg)
        end
    end

    local AUG_STALL = 20

    local function aug_release()
        if not packets_ok or not aug then return end
        if aug.mode == 'Ambuscade' then
            local me = windower.ffxi.get_mob_by_target('me')
            if me then pcall(function() packets.inject(packets.new('outgoing', 0x016, { ['Target Index'] = me.index })) end) end
        elseif not aug.menu then
            return
        else
            pcall(reject_npc)
        end
    end

    local function oseem_submit()
        local style, stone = aug.style, aug.stone
        if not style or style == '' or not stone or stone == '' then return false end
        if stone == 'Pellucid Stone' then
            if (aug.pellucid or 0) < 1 then return false end
            aug.pellucid = aug.pellucid - 1
        elseif stone == 'Fern Stone' then
            if (aug.fern or 0) < 1 then return false end
            aug.fern = aug.fern - 1
        elseif stone == 'Taupe Stone' then
            if (aug.taupe or 0) < 1 then return false end
            aug.taupe = aug.taupe - 1
        elseif stone == 'Dark Matter' then
            if (aug.dark or 0) < 1 then return false end
            aug.dark = aug.dark - 1
        else
            return false
        end
        local styles = gear_style_types[aug.gear]
        if not styles then return false end
        local found = false
        for _, sname in ipairs(styles) do if sname == style then found = true break end end
        if not found then return false end
        packets.inject(packets.new('outgoing', 0x05B, {
            ['Target'] = aug.npc_id, ['Option Index'] = style_types[style], ['_unknown1'] = stone_types[stone],
            ['Target Index'] = aug.npc_index, ['Automated Message'] = true, ['Zone'] = aug.zone, ['Menu ID'] = aug.menu,
        }))
        aug.awaiting = true
        return true
    end

    local function results_text(results)
        local parts = {}
        for k, v in pairs(results) do parts[#parts + 1] = k .. ' ' .. tostring(v) end
        return table.concat(parts, ', ')
    end

    local function gear_process(results)
        aug.results = results
        aug.attempts = aug.attempts + 1
        if aug.manual then
            aug.await_decision = true
            aug.status = 'Inspect roll ' .. aug.attempts
            aug.last_progress = os.clock()
            aug_dirty = true
            return
        end
        if any_match(results) then
            aug.active = false
            aug.status = 'Match found'
            accept_npc()
            alex_chat(207, '[Alexandria] augment match found, kept: ' .. results_text(results), 'progress')
        elseif aug.attempts >= aug.total then
            aug.active = false
            aug.status = 'Reached max attempts'
            reject_npc()
            alex_chat(207, '[Alexandria] augment: no match in ' .. aug.attempts .. ' rolls; rejected last roll, kept previous augments', 'progress')
        elseif aug.mode == 'Geas Fete' and aug.paid then
            -- Paid Dark Matter loop: keep-current on this roll, then (budget permitting) let the tick
            -- trade the next Dark Matter. Same reject + re-trade shape as the Skirmish loop.
            reject_npc()
            if (aug.dm_used or 0) >= (aug.dm_budget or 0) or not aug.dm_id or count_in_bag(aug.dm_id, 0) < 1 then
                aug.active = false
                aug.status = 'Dark Matter spent'
                alex_chat(207, ('[Alexandria] augment: no match in %d Dark Matter; kept previous augments'):format(aug.dm_used or 0), 'progress')
            else
                aug.awaiting = false
                aug.last_trade = os.clock()  -- measure the next-trade delay from now, so the gear has time to return
                aug.status = ('Dark Matter rolls (%d/%d)'):format(aug.dm_used or 0, aug.dm_budget or 0)
            end
        else
            aug.status = 'Rolling (' .. aug.attempts .. ')'
            if aug.mode == 'Geas Fete' then
                coroutine.schedule(function()
                    if aug and aug.active then
                        if not oseem_submit() then aug_start_paid('out of stones, rejected last roll, kept previous augments') end
                    end
                end, aug.delay)
            else
                reject_npc()
                aug.awaiting = false
                aug.last_trade = os.clock()  -- measure the next-trade delay from now, so the gear has time to return
            end
        end
        aug_dirty = true
    end

    function aug_active()
        return aug ~= nil and aug.active == true
    end

    function aug_reset()
        if aug and aug.active then
            aug.active = false
            aug.status = 'Cancelled'
            aug_dirty = true
        end
    end

    function aug_stop()
        if aug and aug.active then
            aug.active = false
            aug.await_decision = false
            aug.status = 'Stopped'
            if aug.menu and (aug.mode == 'Geas Fete' or aug.awaiting) then
                pcall(reject_npc)
            end
            aug_dirty = true
            alex_chat(207, '[Alexandria] augmenting stopped', 'progress')
        end
    end

    function aug_manual_keep()
        if not aug or not aug.active or not aug.await_decision then return end
        aug.await_decision = false
        aug.active = false
        -- Keep means keep THIS roll, always. Manual mode exists so the user decides per roll, so Keep must
        -- accept unconditionally -- never gate on any_match, or a keep with no criteria set (all "(any)")
        -- would reject the very roll the user chose to keep.
        aug.status = 'Kept roll ' .. (aug.attempts or 0)
        pcall(accept_npc)
        alex_chat(207, '[Alexandria] kept roll: ' .. results_text(aug.results or {}), 'progress')
        aug_dirty = true
    end

    function aug_manual_reroll()
        if not aug or not aug.active or not aug.await_decision then return end
        aug.await_decision = false
        aug.last_progress = os.clock()
        aug.status = 'Rolling ' .. (aug.attempts or 0)
        if aug.mode == 'Geas Fete' and aug.paid then
            -- paid: keep-current on this roll, then let the tick trade the next Dark Matter
            reject_npc()
            if (aug.dm_used or 0) >= (aug.dm_budget or 0) or not aug.dm_id or count_in_bag(aug.dm_id, 0) < 1 then
                aug.active = false; aug.status = 'Dark Matter spent'
            else
                aug.awaiting = false; aug.last_trade = os.clock()
            end
        elseif aug.mode == 'Geas Fete' then
            if not oseem_submit() then aug_start_paid('out of stones, rejected last roll, kept previous augments') end
        else
            reject_npc()
            aug.awaiting = false
        end
        aug_dirty = true
    end

    -- Advance a multi-cape sequence to the next step (pull its material, re-prep). Global to stay under
    -- Lua's 200 main-chunk local cap; captures aug_pull_mat / aug_fail as upvalues.
    function aug_advance_step()
        aug.step_index = aug.step_index + 1
        local st = aug.steps[aug.step_index]
        aug.mat_id = st.mat_id
        aug.path_index = st.path_index
        aug.cape_material = st.material
        aug.mat_slot = ({ thread = 1, dust = 2, dye = 3, sap = 4, resin = 5 })[st.material]
        aug.total = st.total
        aug.done = 0
        aug.attempts = 0
        aug.delay = (st.material == 'dye') and 2 or 1
        if not aug_pull_mat(st.mat_id, st.total) then
            aug_fail('material unavailable for step ' .. aug.step_index)
            aug_dirty = true
            return
        end
        aug.prep = true
        aug.prep_deadline = os.clock() + 15
        aug.status = 'Step ' .. aug.step_index .. '/' .. #aug.steps
        aug.next_at = 0
    end

    -- Maximum-safety mode: after each roll the loop pauses (await_step) so the user can see the result
    -- before another material is spent. Continue fires the next roll (or advances to the next sequence
    -- step when the current step's repeats are done); Stop is the normal augstop.
    function aug_step_continue()
        if not aug or not aug.active or not aug.await_step then return end
        aug.await_step = false
        aug.last_progress = os.clock()   -- time spent reviewing is NOT a stall; restart the watchdog
        aug.wait_since = nil
        if aug.advance_on_continue then
            aug.advance_on_continue = false
            aug_advance_step()
        else
            aug.next_at = 0        -- resume: fire the next roll of the current step
        end
        aug_dirty = true
    end

    local function aug_return(now)
        local a = aug
        if not a or not a.return_bag or a.returned then return end
        a.return_deadline = a.return_deadline or (now + 20)
        if not ready_status() then
            if now > a.return_deadline then a.returned = true end
            return
        end
        local id = a.item_id or a.cape_id
        if not id then a.returned = true return end
        local lock = a.item_slot or a.cape_slot
        if find_slot(id) then
            local rb = a.return_bag
            enqueue_fast(function()
                local di = windower.ffxi.get_bag_info(rb)
                if di and (di.max - di.count) <= 0 then return end
                local mslot, mcount
                if lock then
                    local inv0 = windower.ffxi.get_items(0)
                    local it = inv0 and type(inv0) == 'table' and inv0[lock]
                    if type(it) == 'table' and it.id == id and it.id ~= 0 then mslot, mcount = lock, it.count or 1 end
                end
                if not mslot then local m = find_in_bag(0, id, nil); if m then mslot, mcount = m.slot, m.count end end
                if mslot then windower.ffxi.move_item(0, rb, mslot, mcount or 1) end
            end)
            a.returned = true
            aug_dirty = true
            alex_chat(207, '[Alexandria] returned item to its bag', 'progress')
        elseif now > a.return_deadline then
            a.returned = true
        end
    end

    function aug_tick(now)
        local a = aug
        if not a then return end
        if not a.active then
            if a.return_bag and not a.returned then aug_return(now) end
            return
        end
        if not a.await_decision and not a.await_step and (a.awaiting or a.menu) and (now - (a.last_progress or now)) > AUG_STALL then
            if a.mode ~= 'Geas Fete' and a.mode ~= 'Ambuscade' and a.item_id and find_slot(a.item_id) and (a.stall_retries or 0) < 2 then
                a.awaiting = false
                a.last_progress = now
                a.stall_retries = (a.stall_retries or 0) + 1
            else
                aug_release()
                aug_fail('augment timed out, menu released')
                return
            end
        end
        if a.mode == 'Ambuscade' then
            if a.prep then
                -- Readiness gate only: any copy of the cape present + materials pulled. cape_trade
                -- resolves the EXACT instance by fingerprint. (After a step, cape_sig lags one roll, so
                -- aug_cape_find would miss the just-advanced cape here -- use find_slot for the gate.)
                if find_slot(a.cape_id) and count_in_bag(a.mat_id, 0) >= (a.total or 1) then
                    a.mat_slot = ({ thread = 1, dust = 2, dye = 3, sap = 4, resin = 5 })[a.cape_material]
                    a.first_time = a.cape_sig[a.mat_slot] == 'none'
                    a.prep = false
                    a.status = a.multi and ('Step ' .. (a.step_index or 1) .. '/' .. #a.steps) or 'Augmenting'
                    aug_dirty = true
                elseif now > (a.prep_deadline or 0) then
                    aug_fail('could not move to inventory (full?)')
                    return
                else
                    return
                end
            end
            if a.await_step then
                -- Paused for review: never trade while paused. But do confirm the just-finished roll
                -- actually landed on OUR cape, which refreshes cape_sig/slot so the streamed result
                -- reflects the post-roll augments (the cape often changes slot during the trade).
                -- Throttled to once a second so a non-landing roll doesn't rescan inventory every frame.
                if a.verify_pending and now >= (a.verify_next or 0) then
                    a.verify_next = now + 1
                    local slot, cur = aug_cape_find_advanced(a.cape_id, a.cape_sig, a.verify_slot)
                    if slot then
                        a.cape_sig = cur; a.cape_slot = slot; a.verify_pending = false; a.wait_since = nil
                        aug_dirty = true
                    end
                end
                return
            end
            if not a.awaiting and ready_status() and now >= (a.next_at or 0) then
                a.next_at = now + 6
                cape_trade()
            end
        else
            if a.prep then
                if find_slot(a.item_id) and (a.mode == 'Geas Fete' or count_in_bag(a.mat_id, 0) >= (a.total or 1)) then
                    if not a.item_slot then a.item_slot = find_slot(a.item_id) end
                    a.prep = false
                    a.status = 'Rolling'
                    aug_dirty = true
                elseif now > (a.prep_deadline or 0) then
                    aug_fail('could not move to inventory (equipped or inventory full?)')
                    return
                else
                    return
                end
            end
            if not a.awaiting and (now - (a.last_trade or 0)) > a.delay and ready_status() then
                gear_trade(now)
            end
        end
    end

    function aug_incoming(id, data)
        if not aug or not aug.active then return nil end
        if aug.mode == 'Ambuscade' then
            if id == 0x034 or id == 0x032 then
                local ok, p = pcall(packets.parse, 'incoming', data)
                if not (ok and p) then return nil end
                -- Only the augment NPC's own menu event may drive the loop; a stray 0x032/0x034 must
                -- not fire a confirm or advance the counter (that desyncs the menu and wastes a trade).
                if p['NPC Index'] ~= nil and p['NPC Index'] ~= aug.npc_index then return nil end
                if p['Menu ID'] then aug.menu = p['Menu ID'] end
                aug.awaiting = false
                aug.last_progress = os.clock()
                cape_confirm()
                aug.done = (aug.done or 0) + 1
                aug.attempts = aug.done
                amb_log(('ROLL confirmed %d/%d | menu=0x%X'):format(aug.done, aug.total or 1, aug.menu or 0))
                local step_done = aug.done >= (aug.total or 1)
                local more_steps = aug.multi and aug.step_index < #aug.steps
                local cm = aug.confirm_mode or 'none'
                if step_done and not more_steps then
                    aug.active = false
                    aug.status = 'Done'
                    aug.next_at = 0
                    amb_log(('DONE | %d/%d complete | final sig=[%s]'):format(aug.done, aug.total or 1, aug_sig_str(aug.cape_sig)))
                    alex_chat(207, '[Alexandria] cape augmenting complete', 'progress')
                elseif cm == 'step' then
                    -- "Each Step" = full safety: pause after EVERY individual roll so the user reviews the
                    -- result (read live from the cape's extdata) before another material is spent. Continue
                    -- fires the next roll, or advances to the next path when this path's rolls are done.
                    -- (aug.step_index/#aug.steps = the PATH index; aug.done/aug.total = rolls in the path.)
                    aug.await_step = true
                    aug.awaiting = false
                    aug.next_at = 0
                    aug.advance_on_continue = step_done and more_steps
                    aug.status = (step_done and more_steps)
                        and ('Path %d/%d done -- confirm to continue'):format(aug.step_index, #aug.steps)
                        or ('Step %d/%d done -- confirm to continue'):format(aug.done, aug.total)
                    aug_dirty = true
                    return true
                elseif step_done and cm == 'path' then
                    -- "Each Path" = some safety: pause only at each path boundary (after all of a path's rolls).
                    aug.await_step = true
                    aug.awaiting = false
                    aug.next_at = 0
                    aug.advance_on_continue = true
                    aug.status = ('Path %d/%d done -- confirm to continue'):format(aug.step_index, #aug.steps)
                    aug_dirty = true
                    return true
                elseif step_done then
                    aug_advance_step()
                elseif aug.multi then
                    aug.status = 'Step ' .. aug.step_index .. '/' .. #aug.steps .. ' (' .. aug.done .. '/' .. aug.total .. ')'
                    aug.next_at = os.clock() + aug.delay
                else
                    aug.status = 'Augmenting (' .. aug.done .. '/' .. aug.total .. ')'
                    aug.next_at = os.clock() + aug.delay
                end
                aug_dirty = true
                return true
            end
            return nil
        end
        if aug.mode == 'Skirmish' or aug.mode == 'Cape' then
            if id == 0x034 then
                local ok, p = pcall(packets.parse, 'incoming', data)
                if ok and p and p['NPC Index'] == aug.npc_index then
                    aug.menu = p['Menu ID']
                    aug.last_progress = os.clock()
                    gear_process(decode_augment((p['Menu Parameters'] or ''):sub(21)))
                    return true
                end
            end
            return nil
        end
        if aug.mode == 'Geas Fete' then
            if id == 0x034 then
                local ok, p = pcall(packets.parse, 'incoming', data)
                if ok and p and p['NPC Index'] == aug.npc_index then
                    aug.menu = p['Menu ID']
                    aug.last_progress = os.clock()
                    if aug.paid then
                        -- Paid Dark Matter roll: the result comes back as a 0x034 (not the 0x05C the
                        -- free menu-roll uses). Only the one that follows our trade is a result.
                        if aug.awaiting then
                            aug.awaiting = false
                            gear_process(decode_augment((p['Menu Parameters'] or ''):sub(21)))
                        end
                        return true
                    end
                    local mp = p['Menu Parameters'] or ''
                    aug.pellucid = mp:byte(1) or 0
                    aug.fern = mp:byte(2) or 0
                    aug.taupe = mp:byte(3) or 0
                    aug.dark = mp:byte(4) or 0
                    aug.gear = mp:byte(5) or 0
                    aug.awaiting = false
                    if not oseem_submit() then aug_start_paid('out of stones or invalid style') end
                    return true
                end
            elseif id == 0x05C then
                local ok, p = pcall(packets.parse, 'incoming', data)
                if ok and p and p['Menu Parameters'] then
                    aug.last_progress = os.clock()
                    gear_process(decode_augment(p['Menu Parameters']:sub(21)))
                end
                return nil
            end
            return nil
        end
        return nil
    end

    function aug_cape_start(job, material, path, repeats, bag, slot, confirm_mode)
        if not packets_ok then return end
        job = lc(job)
        material = lc(material)
        local cape_name = jobToCapeMap[job]
        if not cape_name then aug_fail('unknown job') return end
        local cape_id = res_id(cape_name)
        local mat_name = 'abdhaljs ' .. material
        local mat_id = res_id(mat_name)
        if not cape_id or not mat_id then aug_fail('cape or material not found') return end
        local paths = allAugPaths[mat_name]
        if not paths then aug_fail('unknown material') return end
        local path_index = nil
        for i, v in pairs(paths) do
            if lc(v) == lc(path) then path_index = i break end
        end
        if not path_index then aug_fail('unknown path') return end
        local npc = windower.ffxi.get_mob_by_name('Gorpa-Masorpa')
        local aug_npc_id, aug_npc_index
        if npc and npc.id then
            aug_npc_id, aug_npc_index = npc.id, npc.index
        else
            local fx = STORE_FIXED_NPCS['Gorpa-Masorpa']
            if fx and store_last_zone == fx.zone then
                aug_npc_id, aug_npc_index = fx.id, fx.index
            else
                aug_fail('Gorpa-Masorpa not nearby') return
            end
        end
        local total_rolls = math.max(1, math.min(tonumber(repeats) or 1, 20))
        local prep = false
        local cape_src
        local cape_slot
        local sb, ss = tonumber(bag), tonumber(slot)
        if sb and ss then
            local items = windower.ffxi.get_items(sb)
            local it = items and type(items) == 'table' and items[ss]
            if type(it) == 'table' and it.id == cape_id and it.id ~= 0 then
                if sb == 0 then
                    cape_slot = it.slot or ss
                else
                    enqueue_move_slot(cape_id, sb, it.slot or ss, it.count or 1)
                    cape_src = sb
                    prep = true
                end
            end
        end
        if not cape_slot and not prep and not find_slot(cape_id) then
            local b, sl, c = bag_find(cape_id)
            if not b then aug_fail('cape not in your bags') return end
            enqueue_move_slot(cape_id, b, sl, c or 1)
            cape_src = b
            prep = true
        end
        local mat_src_bags = aug_src_bags()
        local mat_have = count_in_bag(mat_id, 0)
        if mat_have < total_rolls then
            local mat_other = 0
            for _, bg in ipairs(mat_src_bags) do mat_other = mat_other + count_in_bag(mat_id, bg) end
            if mat_have + mat_other < total_rolls then
                local mn = (res.items[mat_id] and res.items[mat_id].en) or mat_name
                aug_fail(('need %d %s, only %d available'):format(total_rolls, mn, mat_have + mat_other)) return
            end
            local short = total_rolls - mat_have
            for _, bg in ipairs(mat_src_bags) do
                if short <= 0 then break end
                local avail = count_in_bag(mat_id, bg)
                if avail > 0 then
                    local take = math.min(avail, short)
                    enqueue_move(mat_id, bg, 0, take)
                    short = short - take
                    prep = true
                end
            end
        end
        -- Fingerprint the EXACT selected cape now (before any wardrobe move), so we can always relocate
        -- that specific instance among duplicates and never augment the wrong (blank) one.
        local sel_sig = aug_cape_sig_at(sb, ss, cape_id)
        if not sel_sig then aug_fail("could not read the selected cape's augments (need extdata); cannot safely target it among duplicates") return end
        local mat_slot = ({ thread = 1, dust = 2, dye = 3, sap = 4, resin = 5 })[material]
        if not mat_slot then aug_fail('unknown material') return end
        local first_time = sel_sig[mat_slot] == 'none'
        aug = {
            mode = 'Ambuscade', active = true, attempts = 0, done = 0,
            total = total_rolls,
            cape_id = cape_id, cape_slot = cape_slot, mat_id = mat_id, path_index = path_index, cape_material = material,
            cape_sig = sel_sig, mat_slot = mat_slot, verify_pending = false,
            confirm_mode = (confirm_mode == 'step' or confirm_mode == 'path') and confirm_mode or 'none',
            npc_id = aug_npc_id, npc_index = aug_npc_index, npc_name = 'Gorpa-Masorpa', menu = 0x183,
            zone = (windower.ffxi.get_info() or {}).zone or 0,
            first_time = first_time, next_at = 0, delay = (material == 'dye') and 2 or 1,
            prep = prep, prep_deadline = os.clock() + 15, last_progress = os.clock(),
            return_bag = cape_src, returned = false,
            status = prep and 'Moving to inventory' or 'Augmenting',
        }
        aug_dirty = true
        amb_log(('START single | %s(%d) bag=%s slot=%s sig=[%s] mat=%s x%d confirm=%s'):format(
            cape_name, cape_id, tostring(bag), tostring(slot), aug_sig_str(sel_sig), material, total_rolls, tostring(aug.confirm_mode)))
        alex_chat(207, '[Alexandria] augmenting ' .. cape_name .. ' x' .. aug.total, 'progress')
    end

    function aug_cape_seq_start(job, bag, slot, steps, confirm_mode)
        if not packets_ok then return end
        if type(steps) ~= 'table' or #steps == 0 then aug_fail('no steps') return end
        job = lc(job)
        local cape_name = jobToCapeMap[job]
        if not cape_name then aug_fail('unknown job') return end
        local cape_id = res_id(cape_name)
        if not cape_id then aug_fail('cape not found') return end
        local npc = windower.ffxi.get_mob_by_name('Gorpa-Masorpa')
        local aug_npc_id, aug_npc_index
        if npc and npc.id then
            aug_npc_id, aug_npc_index = npc.id, npc.index
        else
            local fx = STORE_FIXED_NPCS['Gorpa-Masorpa']
            if fx and store_last_zone == fx.zone then
                aug_npc_id, aug_npc_index = fx.id, fx.index
            else
                aug_fail('Gorpa-Masorpa not nearby') return
            end
        end
        local norm = {}
        local need_by_mat = {}
        for _, st in ipairs(steps) do
            local material = lc(tostring(st.material or ''))
            local mat_name = 'abdhaljs ' .. material
            local mat_id = res_id(mat_name)
            local paths = allAugPaths[mat_name]
            if not mat_id or not paths then aug_fail('bad material in steps') return end
            local pidx = nil
            for i, v in pairs(paths) do if lc(v) == lc(tostring(st.path)) then pidx = i break end end
            if not pidx then aug_fail('bad path in steps') return end
            local reps = math.max(1, math.min(tonumber(st.repeats) or 1, 20))
            norm[#norm + 1] = { material = material, mat_id = mat_id, path_index = pidx, total = reps }
            need_by_mat[mat_id] = (need_by_mat[mat_id] or 0) + reps
        end
        for mid, need in pairs(need_by_mat) do
            local total = count_in_bag(mid, 0)
            for _, bg in ipairs(aug_src_bags()) do total = total + count_in_bag(mid, bg) end
            if total < need then
                local mn = (res.items[mid] and res.items[mid].en) or ('item ' .. mid)
                aug_fail(('need %d %s, only %d available'):format(need, mn, total)) return
            end
        end
        local prep = false
        local cape_src, cape_slot
        local sb, ss = tonumber(bag), tonumber(slot)
        if sb and ss then
            local items = windower.ffxi.get_items(sb)
            local it = items and type(items) == 'table' and items[ss]
            if type(it) == 'table' and it.id == cape_id and it.id ~= 0 then
                if sb == 0 then
                    cape_slot = it.slot or ss
                else
                    enqueue_move_slot(cape_id, sb, it.slot or ss, it.count or 1)
                    cape_src = sb
                    prep = true
                end
            end
        end
        if not cape_slot and not prep and not find_slot(cape_id) then
            local b, sl, c = bag_find(cape_id)
            if not b then aug_fail('cape not in your bags') return end
            enqueue_move_slot(cape_id, b, sl, c or 1)
            cape_src = b
            prep = true
        end
        local first = norm[1]
        local ok, mprep = aug_pull_mat(first.mat_id, first.total)
        if not ok then aug_fail('material unavailable') return end
        if mprep then prep = true end
        -- Fingerprint the EXACT selected cape now (before any wardrobe move); see aug_cape_start.
        local sel_sig = aug_cape_sig_at(sb, ss, cape_id)
        if not sel_sig then aug_fail("could not read the selected cape's augments (need extdata); cannot safely target it among duplicates") return end
        local fslot = ({ thread = 1, dust = 2, dye = 3, sap = 4, resin = 5 })[first.material]
        if not fslot then aug_fail('unknown material') return end
        local first_time = sel_sig[fslot] == 'none'
        aug = {
            mode = 'Ambuscade', multi = true, steps = norm, step_index = 1,
            active = true, attempts = 0, done = 0, total = first.total,
            cape_id = cape_id, cape_slot = cape_slot, mat_id = first.mat_id,
            path_index = first.path_index, cape_material = first.material,
            cape_sig = sel_sig, mat_slot = fslot, verify_pending = false,
            confirm_mode = (confirm_mode == 'step' or confirm_mode == 'path') and confirm_mode or 'none',
            npc_id = aug_npc_id, npc_index = aug_npc_index, npc_name = 'Gorpa-Masorpa', menu = 0x183,
            zone = (windower.ffxi.get_info() or {}).zone or 0,
            first_time = first_time, next_at = 0, delay = (first.material == 'dye') and 2 or 1,
            prep = prep, prep_deadline = os.clock() + 15, last_progress = os.clock(),
            return_bag = cape_src, returned = false,
            status = prep and 'Moving to inventory' or ('Step 1/' .. #norm),
        }
        aug_dirty = true
        do
            local matdesc = {}
            for _, s in ipairs(norm) do matdesc[#matdesc + 1] = s.material .. ' x' .. s.total end
            amb_log(('START multi | %s(%d) bag=%s slot=%s sig=[%s] paths=[%s] confirm=%s'):format(
                cape_name, cape_id, tostring(bag), tostring(slot), aug_sig_str(sel_sig), table.concat(matdesc, ', '), tostring(aug.confirm_mode)))
        end
        alex_chat(207, '[Alexandria] multi-augmenting ' .. cape_name .. ' (' .. #norm .. ' steps)', 'progress')
    end

    function aug_gear_start(s)
        if not packets_ok then return end
        local mode = tostring(s.mode or '')
        local npc_name = (mode == 'Skirmish' and 'Divainy-Gamainy') or (mode == 'Cape' and 'Detrovio') or (mode == 'Geas Fete' and 'Oseem') or nil
        if not npc_name then aug_fail('unknown mode') return end
        local npc = windower.ffxi.get_mob_by_name(npc_name)
        local aug_npc_id, aug_npc_index
        if npc and npc.id then
            aug_npc_id, aug_npc_index = npc.id, npc.index
        else
            local fx = STORE_FIXED_NPCS[npc_name]
            if fx and store_last_zone == fx.zone then
                aug_npc_id, aug_npc_index = fx.id, fx.index
            else
                aug_fail(npc_name .. ' not nearby') return
            end
        end
        local item_id = res_id(s.item)
        if not item_id then aug_fail('gear not found') return end
        local mat_id = nil
        if mode ~= 'Geas Fete' then
            mat_id = res_id(s.material)
            if not mat_id then aug_fail('material not found') return end
        end
        local req_max = math.max(1, math.min(tonumber(s.max) or 20, 300))
        local roll_max = req_max
        local prep = false
        local gear_src
        local gear_slot
        local sb, ss = tonumber(s.bag), tonumber(s.slot)
        if sb and ss then
            local items = windower.ffxi.get_items(sb)
            local it = items and type(items) == 'table' and items[ss]
            if type(it) == 'table' and it.id == item_id and it.id ~= 0 then
                if sb == 0 then
                    gear_slot = it.slot or ss
                else
                    enqueue_move_slot(item_id, sb, it.slot or ss, it.count or 1)
                    gear_src = sb
                    prep = true
                end
            end
        end
        if not gear_slot and not prep and not find_slot(item_id) then
            local b, sl, c = bag_find(item_id)
            if not b then aug_fail('gear not in your bags') return end
            enqueue_move_slot(item_id, b, sl, c or 1)
            gear_src = b
            prep = true
        end
        if mat_id then
            local mat_src_bags = aug_src_bags()
            local mat_have = count_in_bag(mat_id, 0)
            local mat_total = mat_have
            for _, bg in ipairs(mat_src_bags) do mat_total = mat_total + count_in_bag(mat_id, bg) end
            if mat_total == 0 then aug_fail('material not in your bags') return end
            roll_max = math.min(req_max, mat_total)
            if mat_have < roll_max then
                local short = roll_max - mat_have
                for _, bg in ipairs(mat_src_bags) do
                    if short <= 0 then break end
                    local avail = count_in_bag(mat_id, bg)
                    if avail > 0 then
                        local take = math.min(avail, short)
                        enqueue_move(mat_id, bg, 0, take)
                        short = short - take
                        prep = true
                    end
                end
            end
            if roll_max < req_max then
                alex_chat(207, ('[Alexandria] only %d %s available; rolling up to %d'):format(
                    mat_total, (res.items[mat_id] and res.items[mat_id].en) or tostring(s.material), roll_max), 'progress')
            end
        end
        -- Techniques path: the free daily rolls are done in the menu (the storable-stone code), but
        -- once those run out each roll costs one Dark Matter TRADED with the gear (Dark Matter can't
        -- be stored). Pull the budgeted Dark Matter into inventory so the paid rolls can trade it;
        -- dm_budget caps how many to spend (a set number, or all of them via dm_all).
        local dm_id, dm_budget = nil, 0
        if mode == 'Geas Fete' and lc(tostring(s.material)) == 'dark matter' then
            dm_id = res_id(s.material)
            if dm_id then
                local dm_bags = aug_src_bags()
                local dm_have = count_in_bag(dm_id, 0)
                local dm_total = dm_have
                for _, bg in ipairs(dm_bags) do dm_total = dm_total + count_in_bag(dm_id, bg) end
                dm_budget = s.dm_all and dm_total or math.max(0, math.min(tonumber(s.dm) or 0, dm_total))
                local short = dm_budget - dm_have
                for _, bg in ipairs(dm_bags) do
                    if short <= 0 then break end
                    local avail = count_in_bag(dm_id, bg)
                    if avail > 0 then local take = math.min(avail, short); enqueue_move(dm_id, bg, 0, take); short = short - take; prep = true end
                end
            end
        end
        aug = {
            mode = mode, active = true, attempts = 0,
            total = roll_max,
            item_id = item_id, item_slot = gear_slot, mat_id = mat_id, stone = s.material, style = s.style,
            dm_id = dm_id, dm_budget = dm_budget, dm_used = 0, paid = false,
            a1 = lc(s.augment_1), a2 = lc(s.augment_2), a3 = lc(s.augment_3),
            v1 = tonumber(s.watch_1) or 0, v2 = tonumber(s.watch_2) or 0, v3 = tonumber(s.watch_3) or 0,
            amode = (s.augment_mode == 'or') and 'or' or 'and',
            delay = math.max(0, tonumber(s.delay) or 2),
            npc_id = aug_npc_id, npc_index = aug_npc_index, npc_name = npc_name, menu = nil,
            zone = (windower.ffxi.get_info() or {}).zone or 0,
            accept_option = (mode == 'Geas Fete') and 9 or 7,
            reject_option = (mode == 'Geas Fete') and 0 or 262,
            reject_unknown = (mode == 'Geas Fete') and 16384 or 0,
            last_trade = 0, awaiting = false, last_progress = os.clock(),
            manual = s.manual and true or false, await_decision = false,
            prep = prep, prep_deadline = os.clock() + 15,
            return_bag = gear_src, returned = false,
            status = prep and 'Moving to inventory' or 'Rolling',
        }
        aug_dirty = true
        alex_chat(207, '[Alexandria] augmenting ' .. tostring(s.item) .. ' (' .. mode .. ')', 'progress')
    end

    function aug_cape_info(job, material)
        local cape_name = jobToCapeMap[lc(job)]
        if not cape_name then aug_info = nil aug_info_dirty = true return end
        local augs = read_cape_augs(res_id(cape_name))
        local parts = {}
        for i = 1, 4 do parts[#parts + 1] = '"' .. esc(augs[i] or 'none') .. '"' end
        aug_info = { cape = cape_name, augs = '[' .. table.concat(parts, ',') .. ']' }
        aug_info_dirty = true
    end

    function build_aug()
        local a = aug
        if not a or not a.mode then return '{"t":"aug","active":false}\n' end
        local parts = {
            '"t":"aug"',
            '"active":' .. (a.active and 'true' or 'false'),
            '"mode":"' .. esc(a.mode) .. '"',
            '"attempts":' .. tostring(a.attempts or 0),
            '"total":' .. tostring(a.total or 0),
            '"status":"' .. esc(a.status or '') .. '"',
            '"manual":' .. (a.manual and 'true' or 'false'),
            '"awaitDecision":' .. (a.await_decision and 'true' or 'false'),
            '"awaitStep":' .. (a.await_step and 'true' or 'false'),
        }
        if a.multi then
            parts[#parts + 1] = '"multi":true'
            parts[#parts + 1] = '"step":' .. tostring(a.step_index or 1)
            parts[#parts + 1] = '"stepCount":' .. tostring(a.steps and #a.steps or 0)
        end
        local iid = a.item_id or a.cape_id
        if iid then
            parts[#parts + 1] = '"id":' .. tostring(iid)
            local r = res.items[iid]
            if r and r.en then parts[#parts + 1] = '"item":"' .. esc(r.en) .. '"' end
        end
        if a.results then
            local rs = {}
            for k, v in pairs(a.results) do rs[#rs + 1] = '"' .. esc(k) .. '":' .. tostring(v) end
            parts[#parts + 1] = '"results":{' .. table.concat(rs, ',') .. '}'
        end
        if a.mode == 'Ambuscade' and a.cape_id then
            local cur = {}
            local inv0 = windower.ffxi.get_items(0)
            local it = a.cape_slot and type(inv0) == 'table' and inv0[a.cape_slot]
            if not (type(it) == 'table' and it.id == a.cape_id and it.id ~= 0) then
                -- Locate OUR pinned cape by fingerprint, never a first-match duplicate.
                it = nil
                local s = a.cape_sig and aug_cape_find(a.cape_id, a.cape_sig)
                if s and type(inv0) == 'table' then it = inv0[s] end
            end
            local augs = it and decode_item_augments(it)
            if augs then for _, s in ipairs(augs) do cur[#cur + 1] = '"' .. esc(s) .. '"' end end
            parts[#parts + 1] = '"augs":[' .. table.concat(cur, ',') .. ']'
        end
        return '{' .. table.concat(parts, ',') .. '}\n'
    end

    function build_auginfo()
        if not aug_info then return '{"t":"auginfo","cape":null}\n' end
        return '{"t":"auginfo","cape":"' .. esc(aug_info.cape) .. '","augments":' .. aug_info.augs .. '}\n'
    end
end

do
    local bz_self_index = nil

    local function bz_mem_init()
        if not memhelp_ok then return false end
        if bz_mem_ok then return true end
        local ok, p = pcall(memhelp.find_pattern, 'FFXiMain.dll', '8B560C8B042A8B0485')
        if not ok or not p or p == 0 then return false end
        local ok2, base = pcall(memhelp.read_uint32, p + 9)
        if not ok2 or not base or base == 0 then return false end
        bz_entity_base = base
        bz_mem_ok = true
        return true
    end

    local function bz_has_bazaar(index)
        local ptr = memhelp.read_uint32(bz_entity_base + index * 4)
        if not ptr or ptr == 0 then return false end
        local flags2 = memhelp.read_uint32(ptr + 0x128)
        return flags2 ~= nil and (flags2 % 0x400) >= 0x200
    end

    function bz_mem_collect(me, in_range)
        local out = {}
        if not bz_mem_init() then return out end
        for index = 0x400, 0x6FF do
            if bz_has_bazaar(index) then
                local m = windower.ffxi.get_mob_by_index(index)
                if m and m.id and m.name and m.name ~= '' and m.x and m.id ~= me.id then
                    local dx, dy = m.x - me.x, m.y - me.y
                    local d = math.sqrt(dx * dx + dy * dy)
                    if not in_range or d <= bz_range then
                        out[#out + 1] = { id = m.id, index = index, name = m.name, dist = d }
                    end
                end
            end
        end
        return out
    end

    function bz_mem_available()
        return bz_mem_init()
    end

    function bz_on_charpc(data)
        local sendflg = data:byte(0x0A + 1)
        if not sendflg then return end
        local actindex = data:byte(0x08 + 1) + data:byte(0x09 + 1) * 256
        if actindex < 1024 or actindex >= 1792 then return end
        if bz_self_index and actindex == bz_self_index then
            if bz_flags[actindex] then bz_flags[actindex] = nil; bz_sellers_dirty = true end
            return
        end
        if sendflg % 64 >= 32 then
            if bz_flags[actindex] then bz_flags[actindex] = nil; bz_sellers_dirty = true end
            return
        end
        if sendflg % 8 < 4 then return end
        local b = data:byte(0x23 + 1)
        if not b then return end
        local has = b >= 0x80
        local cur = bz_flags[actindex]
        if has then
            local uniqueno = data:byte(0x04 + 1) + data:byte(0x05 + 1) * 256 + data:byte(0x06 + 1) * 65536 + data:byte(0x07 + 1) * 16777216
            if not cur or cur.id ~= uniqueno then bz_flags[actindex] = { id = uniqueno, has = true }; bz_sellers_dirty = true end
        elseif cur then
            bz_flags[actindex] = nil
            bz_sellers_dirty = true
        end
    end

    function bz_incoming_list(data)
        if not bz_collecting or not bz_collect then return nil end
        local price = data:byte(0x04 + 1) + data:byte(0x05 + 1) * 256 + data:byte(0x06 + 1) * 65536 + data:byte(0x07 + 1) * 16777216
        local qty = data:byte(0x08 + 1) + data:byte(0x09 + 1) * 256 + data:byte(0x0A + 1) * 65536 + data:byte(0x0B + 1) * 16777216
        local tax = data:byte(0x0C + 1) + data:byte(0x0D + 1) * 256
        local itemno = data:byte(0x0E + 1) + data:byte(0x0F + 1) * 256
        local bidx = data:byte(0x10 + 1)
        if itemno and itemno > 0 then
            bz_collect.items[#bz_collect.items + 1] = { id = itemno, price = price, qty = qty, tax = tax, bidx = bidx }
        end
        bz_collect.t = os.clock()
        return true
    end

    function bz_open(id, index, buyspec)
        if not packets_ok or not id or not index then return end
        local m = windower.ffxi.get_mob_by_index(index)
        bz_collect = { id = id, index = index, name = (m and m.name) or '', items = {}, t = os.clock(), buy = buyspec }
        bz_collecting = true
        pcall(windower.packets.inject_outgoing, 0x105, string.char(0x05, 0x07, 0, 0) .. le4(id) .. le2(index) .. le2(0))
    end

    function bz_buy_result(ok, name, reason)
        local b = bz_buy
        bz_buy = nil
        bz_buy_msg = { ok = ok, name = name or '', reason = reason or '', sellerid = (b and b.sellerid) or 0, bidx = (b and b.bidx) or -1, qty = (b and b.num) or 0 }
        bz_buy_dirty = true
    end

    function bz_finish_buy(c)
        bz_items_dirty = true
        local target = nil
        for _, it in ipairs(c.items) do
            if it.bidx == c.buy.bidx then target = it break end
        end
        if not target then bz_buy_result(false, c.name, 'item no longer there') return end
        if target.id ~= c.buy.expect_id then bz_buy_result(false, c.name, 'listing changed') return end
        if c.buy.expect_price and target.price > c.buy.expect_price then bz_buy_result(false, c.name, 'price changed') return end
        local num = c.buy.num or 1
        if target.qty and num > target.qty then num = target.qty end
        if num < 1 then num = 1 end
        pcall(windower.packets.inject_outgoing, 0x106, string.char(0x06, 0x07, 0, 0) .. string.char(c.buy.bidx % 256, 0, 0, 0) .. le4(num))
        bz_buy = { name = c.name, sellerid = c.id, bidx = c.buy.bidx, num = num, t = os.clock() }
    end

    function bz_sweep_step(now)
        local s = bz_sweep
        if not s then return end
        if s.idx > #s.queue then
            s.active = false
            s.current = nil
            bz_sweep_dirty = true
            return
        end
        local nx = s.queue[s.idx]
        s.idx = s.idx + 1
        local m = windower.ffxi.get_mob_by_index(nx.index)
        s.current = (m and m.name) or ''
        bz_sweep_dirty = true
        bz_open(nx.id, nx.index)
    end

    local function bz_start_sweep(list, emptymsg)
        if #list == 0 then
            bz_sweep = { active = false, total = 0, done = 0, current = '' }
            bz_sweep_dirty = true
            alex_chat(207, '[Alexandria] ' .. emptymsg, 'progress')
            return
        end
        bz_sweep = { active = true, total = #list, done = 0, queue = list, idx = 1, next_at = 0, current = '' }
        bz_sweep_dirty = true
    end

    function bz_scan()
        local me = windower.ffxi.get_mob_by_target('me')
        if not me or not me.x then return end
        local list = {}
        if bz_mem_init() then
            for _, s in ipairs(bz_mem_collect(me, true)) do
                list[#list + 1] = { id = s.id, index = s.index }
                if #list >= 30 then break end
            end
        else
            for actindex, f in pairs(bz_flags) do
                if f.has and f.id ~= me.id then
                    local m = windower.ffxi.get_mob_by_index(actindex)
                    if m and m.x then
                        local dx, dy = m.x - me.x, m.y - me.y
                        if math.sqrt(dx * dx + dy * dy) <= bz_range then
                            list[#list + 1] = { id = f.id, index = actindex }
                            if #list >= 30 then break end
                        end
                    end
                end
            end
        end
        bz_start_sweep(list, 'no bazaars in range')
    end

    function bz_deepscan()
        local me = windower.ffxi.get_mob_by_target('me')
        if not me or not me.x then return end
        local arr = windower.ffxi.get_mob_array()
        if not arr then return end
        local list = {}
        for _, m in pairs(arr) do
            if m and m.id and m.name and m.name ~= '' and m.x and m.index and m.index >= 1024 and m.index < 1792 and m.id ~= me.id then
                local dx, dy = m.x - me.x, m.y - me.y
                if math.sqrt(dx * dx + dy * dy) <= bz_range then
                    list[#list + 1] = { id = m.id, index = m.index }
                    if #list >= 30 then break end
                end
            end
        end
        bz_start_sweep(list, 'no players in range')
    end

    function bz_sweep_stop()
        if bz_sweep and bz_sweep.active then
            bz_sweep.active = false
            bz_sweep.current = nil
            bz_collecting = false
            bz_sweep_dirty = true
        end
    end

    function bz_tick(now)
        local p = windower.ffxi.get_player()
        bz_self_index = p and p.index or nil
        if bz_collecting and bz_collect and (now - bz_collect.t) > 0.5 then
            bz_collecting = false
            local c = bz_collect
            if c and c.buy then
                bz_finish_buy(c)
            else
                local has_items = #c.items > 0
                local known = bz_flags[c.index] ~= nil
                if has_items then
                    bz_items_dirty = true
                    if not known then bz_flags[c.index] = { id = c.id, has = true }; bz_sellers_dirty = true end
                elseif known then
                    bz_items_dirty = true
                    bz_flags[c.index] = nil
                    bz_sellers_dirty = true
                end
                if bz_sweep and bz_sweep.active then
                    bz_sweep.done = bz_sweep.done + 1
                    bz_sweep.next_at = now + 0.4
                    bz_sweep_dirty = true
                end
            end
        end
        if bz_sweep and bz_sweep.active and not bz_collecting and now >= (bz_sweep.next_at or 0) then
            bz_sweep_step(now)
        end
        if bz_buy and (now - bz_buy.t) > 6 then
            bz_buy_result(false, bz_buy.name, 'no response')
        end
        if bz_watching and (now - bz_sellers_t) > 1.0 then
            bz_sellers_t = now
            bz_sellers_dirty = true
        end
    end

    function build_bzscan()
        local s = bz_sweep
        if not s then return '{"t":"bzscan","active":false,"total":0,"done":0,"current":""}\n' end
        return '{"t":"bzscan","active":' .. (s.active and 'true' or 'false') .. ',"total":' .. (s.total or 0) .. ',"done":' .. (s.done or 0) .. ',"current":"' .. esc(s.current or '') .. '"}\n'
    end

    function build_bzbuy()
        local b = bz_buy_msg
        if not b then return '{"t":"bzbuy","ok":false,"name":"","reason":"","sellerid":0,"bidx":-1,"qty":0}\n' end
        return '{"t":"bzbuy","ok":' .. (b.ok and 'true' or 'false') .. ',"name":"' .. esc(b.name) .. '","reason":"' .. esc(b.reason) .. '","sellerid":' .. (b.sellerid or 0) .. ',"bidx":' .. (b.bidx or -1) .. ',"qty":' .. (b.qty or 0) .. '}\n'
    end

    function bz_apply(items)
        if not packets_ok then return end
        act_queue[#act_queue + 1] = function() pcall(windower.packets.inject_outgoing, 0x10B, string.char(0x0B, 0x05, 0, 0) .. le4(0)) end
        for _, it in ipairs(items) do
            local idx = tonumber(it.index)
            local pr = tonumber(it.price) or 0
            if idx and idx >= 1 and idx <= 255 then
                act_queue[#act_queue + 1] = function() pcall(windower.packets.inject_outgoing, 0x10A, string.char(0x0A, 0x07, 0, 0) .. string.char(idx, 0, 0, 0) .. le4(pr)) end
            end
        end
        act_queue[#act_queue + 1] = function() pcall(windower.packets.inject_outgoing, 0x109, string.char(0x09, 0x03, 0, 0)) end
        coroutine.schedule(function() bz_my_dirty = true end, math.min(25, 2.5 + #items * 0.6))
        alex_chat(207, '[Alexandria] bazaar prices applied', 'action')
    end

    function bz_message(text)
        if not packets_ok then return end
        text = tostring(text or ''):sub(1, 123)
        local buf = text .. string.rep(' ', 123 - #text)
        pcall(windower.packets.inject_outgoing, 0x0DE, string.char(0xDE, 0x40, 0, 0) .. buf .. string.char(0))
        alex_chat(207, '[Alexandria] bazaar message set', 'action')
    end

    function bz_close()
        if not packets_ok then return end
        pcall(windower.packets.inject_outgoing, 0x104, string.char(0x04, 0x03, 0, 0))
        coroutine.schedule(function() bz_my_dirty = true end, 1.5)
        alex_chat(207, '[Alexandria] bazaar closed', 'action')
    end

    function build_bzsellers()
        local me = windower.ffxi.get_mob_by_target('me')
        local parts = {}
        local mem = false
        if me and me.x then
            if bz_mem_init() then
                mem = true
                for _, s in ipairs(bz_mem_collect(me, false)) do
                    parts[#parts + 1] = ('{"name":"%s","id":%d,"index":%d,"dist":%.1f,"inrange":%s}'):format(esc(s.name), s.id, s.index, s.dist, (s.dist <= 50) and 'true' or 'false')
                end
            else
                for actindex, f in pairs(bz_flags) do
                    if f.has and f.id ~= me.id then
                        local m = windower.ffxi.get_mob_by_index(actindex)
                        if m and m.name and m.name ~= '' and m.x then
                            local dx, dy = m.x - me.x, m.y - me.y
                            local d = math.sqrt(dx * dx + dy * dy)
                            parts[#parts + 1] = ('{"name":"%s","id":%d,"index":%d,"dist":%.1f,"inrange":%s}'):format(esc(m.name), f.id, actindex, d, (d <= 50) and 'true' or 'false')
                        end
                    end
                end
            end
        end
        return '{"t":"bzsellers","mem":' .. (mem and 'true' or 'false') .. ',"list":[' .. table.concat(parts, ',') .. ']}\n'
    end

    function build_bzitems()
        local c = bz_collect
        if not c then return '{"t":"bzitems","seller":null,"items":[]}\n' end
        local parts = {}
        for _, it in ipairs(c.items) do
            local nm = res.items[it.id] and res.items[it.id].en or ('Item ' .. it.id)
            parts[#parts + 1] = ('{"id":%d,"n":"%s","price":%d,"qty":%d,"tax":%d,"bidx":%d}'):format(it.id, esc(nm), it.price, it.qty, it.tax, it.bidx)
        end
        return '{"t":"bzitems","seller":"' .. esc(c.name) .. '","id":' .. c.id .. ',"index":' .. c.index .. ',"items":[' .. table.concat(parts, ',') .. ']}\n'
    end

    function build_bzmy()
        local inv = windower.ffxi.get_items(0)
        local parts = {}
        if inv then
            for s = 1, (inv.max or 80) do
                local it = inv[s]
                if type(it) == 'table' and it.id and it.id > 0 then
                    local r = res.items[it.id]
                    local sellable = r and not (r.flags and (r.flags['No PC Trade'] or r.flags['Linkshell']))
                    local listed = (it.status == 25)
                    if sellable or listed then
                        local nm = (r and r.en) or ('Item ' .. it.id)
                        parts[#parts + 1] = ('{"slot":%d,"id":%d,"n":"%s","count":%d,"listed":%s,"price":%d}'):format(s, it.id, esc(nm), it.count or 1, listed and 'true' or 'false', it.bazaar or 0)
                    end
                end
            end
        end
        return '{"t":"bzmy","items":[' .. table.concat(parts, ',') .. ']}\n'
    end
end

-- ==================== Reforge executor (Monisette / Coelestrox / Aurix) ====================
-- Trade the input piece + all ingredients in ONE 0x036, wait until the piece is ready (next Vana'diel
-- midnight, with a fixed-1h fallback/cap), then collect by Talking (0x01A ActionID 0) and reading the
-- returned menu id: 0x182=ready (collect), 0x183=still working (exit + keep waiting). Every confirm is
-- 0x05B option 0 with Zone=EventNum and Menu ID=EventPara = the received menu. Sequential queue.
-- Reuses the augment injector's proven 0x036/0x05B pattern. Globals to respect the main-chunk local cap.
-- NOTE (2026-08-19): V1 built from captures, NOT yet drive-tested. Moves real materials over ~1h cycles.
rf = nil
rf_dirty = false
rf_last_frame = nil        -- last reforge frame string actually sent, so we can diff and emit on ANY change
rf_paused = nil            -- a paused queue saved to disk for THIS character (survives leaving/reload)
rf_paused_checked = false  -- have we tried loading the paused file yet (once the player is known)
-- Per-NPC "ready to collect" menu id (from //ax captures). Talk returns this menu when the piece is
-- done; any other menu = still working -> option 0 exits and we keep waiting. Trade-confirm and the
-- not-ready exit are menu-agnostic (we echo whatever menu came back), so only this must be known per
-- NPC. "???" is the Relic +2/+3 reforge moogle in Ru'Lude Gardens (trade menu 0xBBD, collect 0xBBE);
-- both its tiers are single-trade so one ready menu covers them.
RF_READY_MENU = { Monisette = 0x182, Ruspix = 0x4B, Coelestrox = 0x1E, ['???'] = 0xBBE }
-- Fixed locations for reforge NPCs whose name must NOT live in STORE_FIXED_NPCS. The storage module
-- iterates STORE_FIXED_NPCS by nearby-mob name (any mob named "???" would match and pollute the Storage
-- panel), and the same physical NPC already serves a separate Storage role as 'Aurix' (Imperial cards).
-- Keeping the reforge location here keeps the two features fully separated.
RF_NPC_FIXED = { ['???'] = { zone = 243, id = 17772865, index = 321 } }
-- Per-NPC trade-confirm option (the 0x05B option chosen on the menu that opens right after the 0x036
-- trade). Most NPCs confirm with option 0; Coelestrox's menu (0x1C) confirms the reforge with option 1.
RF_TRADE_OPTION = { Coelestrox = 1 }
-- Multi-day reforges (Coelestrox AF +2->+3) split into steps where the non-final steps ADVANCE instead of
-- collect: after that day cooks, talk returns this "advance" menu, and choosing this option carries the
-- piece to the next day WITHOUT returning an item. The final step collects normally (RF_READY_MENU).
RF_ADVANCE_MENU = { Coelestrox = 0x1D }
RF_ADVANCE_OPTION = { Coelestrox = 2 }

-- Rem's Tale chapter retrieval from Monisette (she uniquely stores them; they are Empyrean reforge
-- ingredients). Captured sequence: talk (0x01A) -> menu 0x181 (0x034) -> EVENTEND (0x05B) whose option
-- packs low byte = chapter (1-10) and high byte = quantity -> the chapters (item id 4063+chapter) are
-- assigned (0x020). One sequence withdraws the whole requested quantity (captures only ever took 1).
rem = nil
REM_MENU = 0x181
REM_ITEM_BASE = 4063  -- Rem's Tale Ch.N item id = REM_ITEM_BASE + N (Ch.1 = 4064 ... Ch.10 = 4073)

function rf_active() return rf ~= nil and rf.active end

function rf_ready_at(trade_time, timing)
    local hard = trade_time + 3600                          -- fixed 1h fallback / conservative mode
    if timing == 'fixed' then return hard end
    local into_day = (trade_time - 1009810800) % 3456       -- real sec into the current Vana'diel day
    return math.min(trade_time + (3456 - into_day) + 20, hard)  -- next Vana midnight + 20s buffer
end

function rf_inv_slot(item_id)
    if not item_id or item_id == 0 then return nil end
    local inv = windower.ffxi.get_items(0)
    if type(inv) ~= 'table' then return nil end
    for s = 1, (inv.max or 80) do
        local it = inv[s]
        if type(it) == 'table' and it.id == item_id and it.id ~= 0 then return it.slot or s end
    end
    return nil
end

function rf_inv_count(item_id)
    local total = 0
    local inv = windower.ffxi.get_items(0)
    if type(inv) == 'table' then
        for s = 1, (inv.max or 80) do
            local it = inv[s]
            if type(it) == 'table' and it.id == item_id then total = total + (it.count or 0) end
        end
    end
    return total
end

-- Forensic dump: every bag that holds `id`, with count and RAW status, plus inventory free space. Logged
-- on a pull failure so a "have it but reforge says missing" report shows exactly where the game thinks the
-- item is and why it wouldn't move -- no more guessing at equipped vs bazaared vs some other status.
RF_BAG_NAMES = { [0]='inv', [1]='safe', [2]='storage', [3]='temp', [4]='locker', [5]='satchel', [6]='sack',
    [7]='case', [8]='ward1', [9]='safe2', [10]='ward2', [11]='ward3', [12]='ward4', [13]='ward5', [14]='ward6',
    [15]='ward7', [16]='ward8' }
function rf_where(id)
    local parts = {}
    for bag = 0, 16 do
        local items = windower.ffxi.get_items(bag)
        if type(items) == 'table' then
            for s = 1, (items.max or 80) do
                local it = items[s]
                if type(it) == 'table' and it.id == id and it.id ~= 0 then
                    parts[#parts + 1] = ('%s x%d(status=%s)'):format(RF_BAG_NAMES[bag] or ('bag' .. bag), it.count or 1, tostring(it.status))
                end
            end
        end
    end
    local di = windower.ffxi.get_bag_info(0)
    return (#parts > 0 and table.concat(parts, ', ') or 'NOT in any readable bag') .. (di and (' | inv free=' .. (di.max - di.count)) or '')
end

-- Pull an item into inventory from any reachable non-mog bag (satchel/sack/case + wardrobes). Returns
-- 'moving' (already here or a move was queued), 'locked' (present only in an equipped/bazaared slot the
-- game refuses to move), or 'none' (nowhere reachable). The 'locked' case matters: an EQUIPPED piece
-- (e.g. the AF body you're wearing) shows up in a wardrobe but cannot be traded until it's taken off, so
-- the caller can say so instead of spinning until a 20s "missing item id" timeout.
function rf_pull(item_id, need)
    if rf_inv_count(item_id) >= need then return 'moving' end
    local locked = false
    for _, bag in ipairs({ 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16 }) do
        local items = windower.ffxi.get_items(bag)
        if type(items) == 'table' then
            for s = 1, (items.max or 80) do
                local it = items[s]
                if type(it) == 'table' and it.id == item_id and it.id ~= 0 then
                    if it.status == nil or it.status == 0 then
                        local di = windower.ffxi.get_bag_info(0)
                        if di and (di.max - di.count) <= 0 then return 'nospace' end   -- movable, but inventory full
                        enqueue_move(item_id, bag, 0, math.min(it.count or 1, need)); return 'moving'
                    else
                        locked = true   -- equipped (5) / bazaared (25): keep looking for a free copy first
                    end
                end
            end
        end
    end
    return locked and 'locked' or 'none'
end

function rf_npc_near()
    if not rf then return false end
    local info = windower.ffxi.get_info()
    if not info or info.zone ~= rf.zone then return false end
    local m = rf.npc_id and windower.ffxi.get_mob_by_id(rf.npc_id)
    if not m then m = rf.npc_index and windower.ffxi.get_mob_by_index(rf.npc_index) end
    local me = windower.ffxi.get_mob_by_target('me')
    if not (m and me) then return false end
    local dx, dy = (m.x or 0) - (me.x or 0), (m.y or 0) - (me.y or 0)
    return (dx * dx + dy * dy) <= 36  -- within 6 yalms
end

-- ---- Reforge audit log (money-critical: ALWAYS on). A forensic trail under debug/reforge/<date>.log so any
-- lost-material report can be reconstructed exactly -- what was traded, the menu, and the carry-bag counts
-- before and after each trade -- and the safety check (rf_verify_advance) that HALTS the queue instead of
-- silently advancing when a step consumed materials but produced no upgraded piece.
rf_dir_ready = false
RF_VERIFY_SECS = 20
function rf_log(line)
    local base = windower.addon_path .. 'debug/reforge'
    if not rf_dir_ready then
        if windower.dir_exists and windower.create_dir then
            if not windower.dir_exists(windower.addon_path .. 'debug') then windower.create_dir(windower.addon_path .. 'debug') end
            if not windower.dir_exists(base) then windower.create_dir(base) end
        end
        rf_dir_ready = true
    end
    -- Per-CHARACTER file. Multibox game instances share this addons folder (that is why the paused-queue file
    -- is per-name too), so a single shared log would interleave every character's queue and two simultaneous
    -- writes could garble a line. One file per character keeps each queue's trail clean and isolated.
    local me = windower.ffxi.get_player()
    local nm = ((me and me.name) or 'unknown'):gsub('[^%w]', '')
    local ok, f = pcall(io.open, base .. '/' .. nm .. '_' .. os.date('%Y-%m-%d') .. '.log', 'a')
    if ok and f then
        f:write(('[%s] %s | %s\n'):format(os.date('%H:%M:%S'), (me and me.name) or '?', tostring(line)))
        f:close()
    end
end

-- ---- Frame-crash log. The prerender / packet / build_slips paths are wrapped in xpcall; if one throws
-- (e.g. a Windower lib blowing up on a bad table), the loop keeps running instead of stalling silently, and
-- the full stack is captured here so the culprit is exact. One file per character under debug/pull/<date>.log.
pull_dir_ready = false
function pull_log(line)
    local base = windower.addon_path .. 'debug/pull'
    if not pull_dir_ready then
        if windower.dir_exists and windower.create_dir then
            if not windower.dir_exists(windower.addon_path .. 'debug') then windower.create_dir(windower.addon_path .. 'debug') end
            if not windower.dir_exists(base) then windower.create_dir(base) end
        end
        pull_dir_ready = true
    end
    local me = windower.ffxi.get_player()
    local nm = ((me and me.name) or 'unknown'):gsub('[^%w]', '')
    local ok, f = pcall(io.open, base .. '/' .. nm .. '_' .. os.date('%Y-%m-%d') .. '.log', 'a')
    if ok and f then
        f:write(('[%s] %s\n'):format(os.date('%H:%M:%S'), tostring(line)))
        f:close()
    end
end
function rf_item_name(id)
    if not id or id == 0 then return 'none' end
    local r = res and res.items and res.items[id]
    return ((r and r.en) or 'item') .. ' #' .. tostring(id)   -- always carry the id so a wrong-id bug can't hide behind a name
end
-- Total count across the reachable carry bags (inventory + satchel/sack/case + wardrobes). The delta across a
-- trade is the TRUE amount consumed, regardless of which bag the addon pulled the item from.
function rf_carry_count(id)
    if not id or id == 0 then return 0 end
    local n = 0
    for _, bag in ipairs({ 0, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16 }) do
        local items = windower.ffxi.get_items(bag)
        if type(items) == 'table' then
            for s = 1, (items.max or 80) do
                local it = items[s]
                if type(it) == 'table' and it.id == id then n = n + (it.count or 0) end
            end
        end
    end
    return n
end
function rf_snapshot(st)
    local snap = { output = rf_carry_count(st.output_id), input = rf_carry_count(st.input_id or 0), ings = {} }
    for _, ig in ipairs(st.ingredients or {}) do snap.ings[ig.id] = rf_carry_count(ig.id) end
    return snap
end
-- Verify a collected step against its pre-trade snapshot, then advance on success or HALT (never silently
-- proceed) when the piece did not upgrade. `why` = 'ok' (output already in inventory) or 'timeout'.
function rf_verify_advance(st, why)
    local snap = rf.snap
    local out_gain = rf_carry_count(st.output_id) - ((snap and snap.output) or 0)
    if st.advance or out_gain >= 1 or not snap then
        -- Success, an advance step (yields no item), or a resumed/collect-only step we have no snapshot for.
        if snap then
            local parts = {}
            for _, ig in ipairs(st.ingredients or {}) do parts[#parts + 1] = ('%s -%d'):format(rf_item_name(ig.id), (snap.ings[ig.id] or 0) - rf_carry_count(ig.id)) end
            rf_log(('OK step %d/%d (%s): %s +%d; input -%d; mats: %s'):format(rf.step_index, #rf.steps, why, rf_item_name(st.output_id), out_gain, (snap.input or 0) - rf_carry_count(st.input_id or 0), table.concat(parts, ', ')))
        else
            rf_log(('OK step %d/%d (%s): %s (resumed step, no pre-trade snapshot)'):format(rf.step_index, #rf.steps, why, rf_item_name(st.output_id)))
        end
        rf.snap = nil
        rf_advance()
        return
    end
    -- No upgraded piece: diff the materials to distinguish a real loss from a trade that never landed.
    local consumed = {}
    local any = false
    for _, ig in ipairs(st.ingredients or {}) do
        local d = (snap.ings[ig.id] or 0) - rf_carry_count(ig.id)
        if d ~= 0 then any = true end
        consumed[#consumed + 1] = ('%s -%d (of %d)'):format(rf_item_name(ig.id), d, ig.qty)
    end
    local in_d = (snap.input or 0) - rf_carry_count(st.input_id or 0)
    if in_d ~= 0 then any = true end
    local detail = ('%s +%d; input %s -%d; mats: %s'):format(rf_item_name(st.output_id), out_gain, rf_item_name(st.input_id or 0), in_d, table.concat(consumed, ', '))
    rf.active = false; rf.phase = 'error'; rf.snap = nil; rf_dirty = true
    if any then
        rf_log(('LOSS step %d/%d (%s): NO upgraded piece but materials were consumed -> %s'):format(rf.step_index, #rf.steps, why, detail))
        rf.status = 'HALTED: materials consumed, no upgrade -- see debug/reforge log'
        alex_chat(207, ('[Alexandria] reforge HALTED: %s did not upgrade but materials were consumed. Stopped to protect the rest of your queue. See debug/reforge log.'):format(rf_item_name(st.output_id)), 'error')
    else
        rf_log(('ANOMALY step %d/%d (%s): no upgraded piece and nothing consumed -> %s'):format(rf.step_index, #rf.steps, why, detail))
        rf.status = 'HALTED: no result detected -- see debug/reforge log'
        alex_chat(207, '[Alexandria] reforge HALTED: no result detected for this step (nothing was consumed). Stopped to be safe. See debug/reforge log.', 'error')
    end
end

function rf_fail(msg)
    if rf then rf_log(('FAIL step %d/%d: %s'):format(rf.step_index or 0, (rf.steps and #rf.steps) or 0, tostring(msg))); rf.active = false; rf.phase = 'error'; rf.status = msg end
    rf_dirty = true
    alex_chat(207, '[Alexandria] reforge: ' .. tostring(msg), 'progress')
end

function rf_stop()
    if rf then rf.active = false; rf.phase = 'stopped'; rf.status = 'stopped' end
    rf_dirty = true
    alex_chat(207, '[Alexandria] reforge stopped', 'progress')
end

function rf_setup_step()
    local st = rf.steps[rf.step_index]
    local rfx = RF_NPC_FIXED[st.npc]
    local fx = rfx or STORE_FIXED_NPCS[st.npc]
    local live = windower.ffxi.get_mob_by_name and windower.ffxi.get_mob_by_name(st.npc)
    -- Ambiguous names (RF_NPC_FIXED, e.g. "???") appear on many nameless mobs, so only trust a live match
    -- with the known id; otherwise fall back to the fixed entry so we never target the wrong NPC.
    if rfx and live and live.id and live.id ~= rfx.id then live = nil end
    if live and live.id then
        rf.npc_id, rf.npc_index = live.id, live.index
        rf.zone = (windower.ffxi.get_info() or {}).zone or (fx and fx.zone) or 0
    elseif fx then
        rf.npc_id, rf.npc_index, rf.zone = fx.id, fx.index, fx.zone
    else
        rf.npc_id, rf.npc_index, rf.zone = nil, nil, (windower.ffxi.get_info() or {}).zone or 0
    end
    -- An advance step (non-final day of a multi-day reforge) waits on the ADVANCE menu and confirms with
    -- the advance option, returning no item; a normal step waits on the ready menu and collects with 0.
    rf.ready_menu = st.advance and RF_ADVANCE_MENU[st.npc] or RF_READY_MENU[st.npc]
    rf.collect_option = st.advance and (RF_ADVANCE_OPTION[st.npc] or 0) or 0
    rf.rem_done = {}   -- chapters we already fired a Monisette retrieve for this step (avoid re-looping)
    if st.pending then
        -- Already-traded / in-flight piece: skip the trade and go straight to collecting. Use the saved
        -- ready time when resuming a pause (so the countdown is exact); otherwise 0 = try now, and if it
        -- isn't done, rf_incoming reschedules for the next Vana'diel day.
        rf.phase = 'wait'; rf.awaiting = false; rf.status = 'collecting in-flight piece'; rf.ready_at = st.pending_ready_at or 0
    else
        rf.phase = 'prep'; rf.awaiting = false; rf.status = 'preparing'
    end
    rf.prep_since = os.clock()
end

function rf_do_trade()
    local st = rf.steps[rf.step_index]
    -- SAFETY: the FIRST trade of a piece MUST include the gear. If step 1 carries materials but no input piece
    -- (input_id 0/nil -- a desktop bug where the gear id did not resolve), trading the materials alone hands
    -- them to the NPC for nothing: the "only the Etched Memories vanished, the feet were untouched" report.
    -- Refuse and halt so nothing is lost. (Day-2+ advance steps legitimately trade materials only.)
    if rf.step_index == 1 and not st.pending and not rf.collect_only and (not st.input_id or st.input_id == 0)
       and st.ingredients and #st.ingredients > 0 then
        rf_log('ABORT step 1: materials but NO gear piece (input missing) -- refusing to trade to avoid losing them')
        rf_fail('no gear piece to trade (input id missing) -- refused to trade the materials alone')
        return
    end
    -- SAFETY: step 1's input gear must be present in a reachable bag. Nothing before step 1 produces it (later
    -- chained steps consume a piece the PREVIOUS step made, but step 1 does not), so if it is nowhere in your
    -- bags it was already traded -- the piece is in flight / cooking at the NPC from an earlier run, or you no
    -- longer have it. Re-handing it is impossible, so refuse instead of wedging on a 20s gather that can never
    -- succeed, and tell the user to collect the in-flight piece at the NPC. 2s grace lets a just-loaded bag settle.
    if rf.step_index == 1 and not st.pending and not rf.collect_only
       and st.input_id and st.input_id > 0 and rf_carry_count(st.input_id) < 1
       and (os.clock() - (rf.prep_since or os.clock())) > 2 then
        rf_log(('ABORT step 1: input %s not in any bag -- already traded (in flight) or missing; refusing to re-trade'):format(rf_item_name(st.input_id)))
        rf_fail(('%s is not in your bags -- looks already traded (in flight at %s). Collect it there when ready; nothing was re-traded.'):format(rf_item_name(st.input_id), st.npc))
        return
    end
    -- Day 2 of a multi-day reforge trades materials only -- the piece is already held by the NPC, so an
    -- input_id of 0/nil means "no piece to hand over".
    local need = (st.input_id and st.input_id > 0) and { { id = st.input_id, qty = 1 } } or {}
    for _, ig in ipairs(st.ingredients) do need[#need + 1] = ig end
    for _, nd in ipairs(need) do
        if rf_inv_count(nd.id) < nd.qty then
            -- Rem's Tale chapters can't live in a bag; if enough are stored with Monisette (whom we are
            -- already standing at), pull the shortfall out of storage automatically before trading.
            local ch = (nd.id > REM_ITEM_BASE and nd.id <= REM_ITEM_BASE + 10) and (nd.id - REM_ITEM_BASE) or nil
            if ch then
                if rem_active() then rf.status = 'retrieving Rems Tale Ch.' .. ch; return end
                -- Don't judge a chapter "missing" until the currency page is actually loaded (a fresh
                -- reload starts with none). Ask for it and wait up to 15s before giving up.
                if not rem_currency_ready() then
                    currency_request()
                    if (os.clock() - (rf.prep_since or os.clock())) < 15 then rf.status = 'checking Monisette storage'; return end
                else
                    local shortfall = nd.qty - rf_inv_count(nd.id)
                    if not rf.rem_done[ch] and rem_stored_count(ch) >= shortfall then
                        rf.rem_done[ch] = true
                        rem_start({ chapter = ch, count = shortfall }, true)  -- reforge-driven; bypasses the "reforge running" guard
                        rf.status = 'retrieving Rems Tale Ch.' .. ch
                        rf.prep_since = os.clock()   -- the retrieve is legitimate progress; don't let the 20s stall fire
                        return
                    end
                end
                -- currency loaded but not enough stored (or already tried): fall through to missing-item path
            end
            local pull = rf_pull(nd.id, nd.qty)   -- 'moving' | 'locked' | 'nospace' | 'none'
            if pull == 'locked' then
                -- The piece exists but only in an equipped/bazaared slot the game won't move, so no amount of
                -- waiting will bring it to inventory. Fail immediately with an actionable message instead of
                -- the cryptic 20s "missing item id" (the "reforge doesn't recognize my item" report). The log
                -- line records which of the silent-drop causes it actually was, so we never have to guess.
                rf_log(('ABORT: %s not movable to inventory | where: %s'):format(rf_item_name(nd.id), rf_where(nd.id)))
                rf_fail(('%s is equipped or on your bazaar -- take it off, then reforge.'):format(rf_item_name(nd.id)))
                return
            end
            if pull == 'nospace' then
                rf_log(('ABORT: %s present but inventory full | where: %s'):format(rf_item_name(nd.id), rf_where(nd.id)))
                rf_fail(('Inventory is full -- free a slot so %s can be moved in to reforge.'):format(rf_item_name(nd.id)))
                return
            end
            -- Do NOT fail instantly: a just-collected chained input, or an in-flight bag move, may still
            -- be registering. Wait up to 20s (prep_since resets each step) before giving up.
            if (os.clock() - (rf.prep_since or os.clock())) > 20 then
                rf_log(('MISSING %s after 20s (pull=%s) | where: %s'):format(rf_item_name(nd.id), tostring(pull), rf_where(nd.id)))
                rf_fail('missing item id ' .. tostring(nd.id) .. ' (need ' .. tostring(nd.qty) .. ') after 20s')
            else
                rf.status = 'gathering items'
            end
            return
        end
    end
    local fields = { ['Target'] = rf.npc_id, ['Target Index'] = rf.npc_index }
    local n = 0
    for _, nd in ipairs(need) do
        local slot = rf_inv_slot(nd.id)
        if not slot then rf.status = 'moving items to inventory'; return end
        n = n + 1
        fields['Item Index ' .. n] = slot
        fields['Item Count ' .. n] = nd.qty
    end
    fields['Number of Items'] = n
    -- Snapshot the exact carry-bag counts of everything we are about to hand over, so after the collect we can
    -- prove what was consumed vs produced (and HALT if a piece was eaten without upgrading). Money-critical.
    rf.snap = rf_snapshot(st)
    local traded = {}
    for _, nd in ipairs(need) do traded[#traded + 1] = ('%s x%d'):format(rf_item_name(nd.id), nd.qty) end
    rf_log(('TRADE step %d/%d @ %s: %s | have(out=%d,input=%d)'):format(rf.step_index, #rf.steps, st.npc, table.concat(traded, ', '), rf.snap.output, rf.snap.input))
    packets.inject(packets.new('outgoing', 0x036, fields))
    rf.phase = 'await_trade'; rf.awaiting = true; rf.last_progress = os.clock(); rf.status = 'trading'
end

-- 0x05B option 0 to confirm/close whatever menu id came back (Zone=EventNum, Menu ID=EventPara).
function rf_send_option(menu, opt)
    packets.inject(packets.new('outgoing', 0x05B, {
        ['Target'] = rf.npc_id, ['Option Index'] = opt or 0, ['Target Index'] = rf.npc_index,
        ['Zone'] = rf.zone, ['Menu ID'] = menu,
    }))
end

-- Count how many of an item the player holds across inventory + wardrobes (where a reforged piece lands or
-- gets organized to). Used to detect that a step's output already arrived, so an already-collected reforge
-- doesn't loop forever waiting for a collect menu that will never appear.
function rf_inv_count(id)
    if not id then return 0 end
    local n = 0
    for _, b in ipairs({ 0, 8, 10, 11, 12, 13, 14, 15, 16 }) do
        local items = windower.ffxi.get_items(b)
        if type(items) == 'table' then
            for s = 1, (items.max or 80) do
                local it = items[s]
                if type(it) == 'table' and it.id == id then n = n + (it.count or 1) end
            end
        end
    end
    return n
end

function rf_do_collect()
    rf_log(('COLLECT step %d/%d @ %s: talking (%ds since trade, expect ready_menu=0x%03X)'):format(
        rf.step_index, #rf.steps, rf.steps[rf.step_index].npc, math.floor(os.time() - (rf.trade_at or os.time())), rf.ready_menu or 0))
    packets.inject(packets.new('outgoing', 0x01A, {
        ['Target'] = rf.npc_id, ['Target Index'] = rf.npc_index, ['Category'] = 0, ['Param'] = 0,
    }))
    rf.phase = 'await_collect'; rf.awaiting = true; rf.last_progress = os.clock(); rf.status = 'collecting'
end

function rf_advance()
    rf.steps[rf.step_index].collected = true
    if rf.step_index >= #rf.steps then
        rf.active = false; rf.phase = 'done'; rf.status = 'done'
        rf_log(('DONE: queue complete (%d step(s))'):format(#rf.steps))
        alex_chat(207, '[Alexandria] reforge queue complete', 'progress'); rf_dirty = true; return
    end
    if rf.confirm_steps then
        rf.await_step = true; rf.phase = 'confirm'; rf.status = 'confirm to continue'; rf_dirty = true; return
    end
    rf.step_index = rf.step_index + 1; rf_setup_step(); rf_dirty = true
end

function rf_step_continue()
    if not rf or not rf.active or not rf.await_step then return end
    rf.await_step = false; rf.step_index = rf.step_index + 1; rf_setup_step(); rf_dirty = true
end

function rf_start(msg)
    if not packets_ok then return end
    if type(msg.steps) ~= 'table' or #msg.steps == 0 then
        if not (rf and rf.active) then rf_fail('no steps') end   -- never tear down a running queue over an empty add
        return
    end
    local steps = {}
    for _, s in ipairs(msg.steps) do
        local ings = {}
        if type(s.ingredients) == 'table' then
            for _, ig in ipairs(s.ingredients) do
                if ig.id and ig.qty then ings[#ings + 1] = { id = tonumber(ig.id), qty = tonumber(ig.qty) } end
            end
        end
        steps[#steps + 1] = { npc = tostring(s.npc or 'Monisette'), input_id = tonumber(s.input_id),
            output_id = tonumber(s.output_id), ingredients = ings, currency = s.currency,
            pending = s.pending and true or false, pending_ready_at = tonumber(s.ready_at),
            advance = s.advance and true or false, collected = false }
    end
    for _, s in ipairs(steps) do
        local needed = s.advance and RF_ADVANCE_MENU[s.npc] or RF_READY_MENU[s.npc]
        if not needed then
            -- Unsupported NPC: reject just this request. Only fail (stop) an idle attempt; never kill a
            -- running queue, or we would orphan the piece it already traded.
            if rf and rf.active then alex_chat(207, '[Alexandria] reforge: ' .. tostring(s.npc) .. ' not supported; nothing added', 'progress')
            else rf_fail(tostring(s.npc) .. ' reforges are not supported yet (needs a packet capture)') end
            return
        end
    end
    if rf and rf.active then
        -- Add-more-while-running: APPEND to the live queue instead of clobbering it. The current piece
        -- keeps cooking and the new steps run after it. (This branch previously called rf_fail, which set
        -- rf.active = false and silently killed the in-flight reforge, so it never collected the traded
        -- piece -- the "stuck at collecting, doesn't detect what was picked up" bug.)
        for _, s in ipairs(steps) do rf.steps[#rf.steps + 1] = s end
        rf_dirty = true
        alex_chat(207, '[Alexandria] reforge: added ' .. #steps .. ' step(s) to the running queue', 'progress')
        return
    end
    rf = { active = true, steps = steps, step_index = 1,
        confirm_steps = msg.confirm_steps and true or false,
        timing = (msg.timing == 'fixed') and 'fixed' or 'smart',
        phase = 'prep', last_progress = os.clock() }
    currency_request()   -- refresh the currency page up front so Rem's Tale stored counts are current
    rf_setup_step(); rf_dirty = true
    local plan = {}
    for i, s in ipairs(steps) do plan[i] = ('%s->%s'):format(rf_item_name(s.input_id), rf_item_name(s.output_id)) end
    rf_log(('START: %d step(s) [%s] timing=%s'):format(#steps, table.concat(plan, ', '), rf.timing))
    alex_chat(207, '[Alexandria] reforge started: ' .. #steps .. ' step(s)', 'progress')
end

-- Per-character paused-reforge file, so several characters can each hold their own paused queue.
function rf_paused_path()
    local me = windower.ffxi.get_player()
    local nm = ((me and me.name) or 'unknown'):gsub('[^%w]', '')
    return windower.addon_path .. 'data/reforge_paused_' .. nm .. '.json'
end

function rf_load_paused()
    rf_paused = nil
    local f = io.open(rf_paused_path(), 'r')
    if f then
        local raw = f:read('*a'); f:close()
        if json_ok and raw and #raw > 0 then
            local ok, d = pcall(json.decode, raw)
            if ok and type(d) == 'table' and type(d.steps) == 'table' and #d.steps > 0 then rf_paused = d end
        end
    end
    rf_dirty = true
end

function rf_clear_paused()
    pcall(os.remove, rf_paused_path())
    rf_paused = nil
    rf_dirty = true
end

-- Save the remaining work and stop. The current step, if already traded (phase is past the trade), is
-- flagged pending so resume collects it; steps not yet reached are saved as normal trades.
function rf_pause()
    if not rf or not rf.active then return end
    if not json_ok then alex_chat(207, '[Alexandria] cannot save paused reforge (json unavailable)', 'error') return end
    local out = { confirm_steps = rf.confirm_steps, timing = rf.timing, steps = {} }
    for i = (rf.step_index or 1), #rf.steps do
        local st = rf.steps[i]
        local step = { npc = st.npc, input_id = st.input_id, output_id = st.output_id, ingredients = st.ingredients, currency = st.currency,
            pending = st.pending and true or false }
        if i == rf.step_index then
            local traded = (rf.phase == 'wait' or rf.phase == 'await_collect' or rf.phase == 'collected')
            if traded or st.pending then step.pending = true; step.ready_at = rf.ready_at end
        end
        out.steps[#out.steps + 1] = step
    end
    local f = io.open(rf_paused_path(), 'w')
    if f then f:write(json.encode(out)); f:close() end
    rf_paused = out
    rf.active = false; rf = nil; rf_dirty = true
    alex_chat(207, ('[Alexandria] reforge paused -- %d step(s) saved. Resume near the NPC.'):format(#out.steps), 'progress')
end

function rf_resume()
    if rf and rf.active then return end
    rf_load_paused()
    if not rf_paused then alex_chat(207, '[Alexandria] no paused reforge to resume', 'error') return end
    local msg = { steps = rf_paused.steps, confirm_steps = rf_paused.confirm_steps, timing = rf_paused.timing }
    rf_clear_paused()
    rf_start(msg)
end

-- Collect a reforge that was ALREADY traded (piece is in flight / cooking at the NPC) but whose queue
-- was lost. Skips the trade entirely: talk -> if the ready menu comes back, collect; otherwise report
-- that nothing is ready and stop (never loops). output_id (optional) lets us verify the returned piece.
function rf_collect_start(msg)
    if not packets_ok then return end
    if rf and rf.active then rf_fail('already running') return end
    local npc = tostring(msg.npc or 'Monisette')
    if not RF_READY_MENU[npc] then rf_fail(npc .. ' collect is not supported yet') return end
    rf = { active = true, collect_only = true, step_index = 1,
        steps = { { npc = npc, output_id = tonumber(msg.output_id) or 0, input_id = 0, ingredients = {}, collected = false } },
        confirm_steps = false, timing = 'smart', phase = 'prep', last_progress = os.clock() }
    rf_setup_step()
    rf.phase = 'wait'; rf.awaiting = false; rf.ready_at = 0   -- try to collect the in-flight piece right now
    rf_dirty = true
    alex_chat(207, '[Alexandria] collecting pending reforge from ' .. npc .. '...', 'progress')
end

function rf_tick(now)
    if not rf or not rf.active or rf.await_step then return end
    -- Trace every status transition (prep never logged its sub-states, so a stall showed only START). This
    -- makes the next "stuck on Gathering" report pinpoint whether it is go-to-NPC, a missing material, a
    -- Rem's Tale retrieve, or the collect wait -- without per-tick spam.
    if rf.phase == 'prep' and rf.status ~= rf.last_status_log then
        rf.last_status_log = rf.status
        rf_log(('PREP step %d/%d: %s | npc=%s near=%s zone=%s'):format(rf.step_index or 0, (rf.steps and #rf.steps) or 0,
            tostring(rf.status), tostring(rf.steps and rf.steps[rf.step_index] and rf.steps[rf.step_index].npc),
            tostring(rf_npc_near()), tostring((windower.ffxi.get_info() or {}).zone)))
    end
    local st = rf.steps[rf.step_index]
    if rf.phase == 'prep' then
        if not rf_npc_near() then rf.status = 'go to ' .. st.npc; return end
        rf_do_trade(); rf_dirty = true
    elseif rf.phase == 'await_trade' then
        if (os.clock() - (rf.last_progress or now)) > 20 then rf_fail('trade timed out') end
    elseif rf.phase == 'wait' then
        if os.time() >= (rf.ready_at or 0) then
            if not rf_npc_near() then rf.status = 'ready -- return to ' .. st.npc; return end
            rf_do_collect(); rf_dirty = true
        else
            rf.status = 'waiting'
        end
    elseif rf.phase == 'await_collect' then
        if (os.clock() - (rf.last_progress or now)) > 20 then rf.phase = 'wait'; rf.awaiting = false end
    elseif rf.phase == 'collected' then
        -- Advance only once the reforged piece has actually registered in inventory (it returns via a
        -- 0x020 a moment after the collect confirm), so the next chained step can trade it in. 8s cap is
        -- a safety net so a missed 0x020 never wedges the queue. An ADVANCE step returns no item, so it
        -- moves on right away.
        -- Verify against the pre-trade snapshot instead of blindly advancing: a piece that never came back
        -- (materials consumed, no upgrade) now HALTS the queue with a logged LOSS line instead of silently
        -- moving on and eating the next step's materials too.
        if st.advance or rf_inv_count(st.output_id) >= 1 then
            rf_verify_advance(st, 'ok')
        elseif (os.clock() - (rf.collect_at or now)) > RF_VERIFY_SECS then
            rf_verify_advance(st, 'timeout')
        end
    end
end

function rf_incoming(id, data)
    if not rf or not rf.active then return nil end
    if id ~= 0x034 and id ~= 0x032 then return nil end
    local ok, p = pcall(packets.parse, 'incoming', data)
    if not (ok and p) then return nil end
    if p['NPC Index'] ~= nil and p['NPC Index'] ~= rf.npc_index then return nil end
    local menu = p['Menu ID']
    if rf.phase == 'await_trade' then
        local tst = rf.steps[rf.step_index]
        rf_log(('CONFIRM step %d: menu=0x%03X opt=%d'):format(rf.step_index, menu or 0x184, (tst and RF_TRADE_OPTION[tst.npc]) or 0))
        rf_send_option(menu or 0x184, tst and RF_TRADE_OPTION[tst.npc] or 0)
        rf.trade_at = os.time(); rf.ready_at = rf_ready_at(rf.trade_at, rf.timing)
        if tst then tst.out_baseline = rf_inv_count(tst.output_id) end   -- how many of the +1 we hold BEFORE it comes back
        rf.phase = 'wait'; rf.awaiting = false; rf.last_progress = os.clock(); rf_dirty = true
        return true
    elseif rf.phase == 'await_collect' then
        rf_log(('COLLECT-RESP step %d: menu=0x%03X %s (expected 0x%03X)'):format(
            rf.step_index, menu or 0, (menu == rf.ready_menu) and 'READY' or 'NOT-ready', rf.ready_menu or 0))
        if menu == rf.ready_menu then
            rf_send_option(menu, rf.collect_option or 0)   -- advance step uses its advance option; a normal collect uses 0
            rf.phase = 'collected'; rf.awaiting = false; rf.collect_at = os.clock(); rf.status = rf.steps[rf.step_index].advance and 'advancing' or 'collecting'; rf_dirty = true
        else
            rf_send_option(menu or rf.ready_menu)   -- option 0 exits the menu
            local st = rf.steps[rf.step_index]
            -- Already collected? If the +1 output is now in inventory (beyond the pre-trade baseline), the
            -- reforge finished and the piece was picked up (auto or manual). The ready menu (0x182) will never
            -- appear again, so stop waiting on it and advance the queue instead of looping forever.
            if st and not st.advance and st.output_id and rf_inv_count(st.output_id) > (st.out_baseline or 0) then
                rf_log(('COLLECT step %d: output #%d already in inventory -> already collected, advancing'):format(rf.step_index, st.output_id))
                rf.awaiting = false; rf_advance(); rf_dirty = true
                return true
            end
            if rf.collect_only then
                -- A one-shot "collect what's in flight": if it isn't ready, don't loop -- just report and stop.
                rf.active = false; rf.phase = 'done'; rf.status = 'nothing ready to collect'
                alex_chat(207, '[Alexandria] nothing ready to collect there yet (still cooking, or nothing pending)', 'progress')
            elseif st and st.pending and (rf.ready_at or 0) == 0 then
                -- In-flight queue step, not done yet: wait for the next Vana'diel day, then collect.
                rf.ready_at = rf_ready_at(os.time(), rf.timing); rf.phase = 'wait'; rf.awaiting = false; rf.status = 'waiting for next day'
            else
                rf.phase = 'wait'; rf.awaiting = false; rf.ready_at = os.time() + 60; rf.status = 'not ready yet'   -- still working / idle: keep waiting
            end
            rf_dirty = true
        end
        return true
    end
    return nil
end

function build_reforge()
    if not rf then
        if rf_paused and rf_paused.steps and #rf_paused.steps > 0 then
            return string.format('{"t":"reforge","active":false,"paused":{"steps":%d,"npc":"%s"}}\n', #rf_paused.steps, esc(rf_paused.steps[1].npc or ''))
        end
        return '{"t":"reforge","active":false}\n'
    end
    local st = rf.steps[rf.step_index]
    -- readyAt is an absolute os.time() (Earth unix seconds); the desktop counts down live from it.
    local ready_at = (rf.phase == 'wait' and rf.ready_at) or 0
    local outs = {}
    for _, s in ipairs(rf.steps or {}) do outs[#outs + 1] = tostring(s.output_id or 0) end
    return string.format('{"t":"reforge","active":%s,"phase":"%s","step":%d,"steps":%d,"status":"%s","readyAt":%d,"awaitStep":%s,"timing":"%s","output":%d,"outputs":[%s]}\n',
        rf.active and 'true' or 'false', esc(rf.phase or ''), rf.step_index or 1, (rf.steps and #rf.steps) or 0,
        esc(rf.status or ''), ready_at, rf.await_step and 'true' or 'false', esc(rf.timing or 'smart'),
        (st and st.output_id) or 0, table.concat(outs, ','))
end

function rem_active() return rem ~= nil and rem.active end

function rem_near()
    if not rem then return false end
    local info = windower.ffxi.get_info()
    if not info or info.zone ~= rem.zone then return false end
    local m = rem.npc_id and windower.ffxi.get_mob_by_id(rem.npc_id)
    if not m then m = rem.npc_index and windower.ffxi.get_mob_by_index(rem.npc_index) end
    local me = windower.ffxi.get_mob_by_target('me')
    if not (m and me) then return false end
    local dx, dy = (m.x or 0) - (me.x or 0), (m.y or 0) - (me.y or 0)
    return (dx * dx + dy * dy) <= 36  -- within 6 yalms
end

function rem_fail(msg)
    rem = nil
    alex_chat(207, '[Alexandria] rem: ' .. tostring(msg), 'progress')
end

-- How many of Rem's Tale Ch.<ch> this character has stored with Monisette (from the 0x113 currency
-- page). Used by the reforge executor to decide whether a short chapter can be auto-retrieved.
function rem_stored_count(ch)
    local pid = (windower.ffxi.get_player() or {}).id
    if not (currency_cur1 and currency_cur1_id == pid) then return 0 end
    local v = currency_cur1['Rems Tale Chapter ' .. ch]
    return (type(v) == 'number') and v or 0
end

-- Is our currency page loaded for THIS character? A fresh //lua reload starts with none (the server
-- only resends 0x113 on a currency change), so stored counts read 0 until we ask for a refresh.
function rem_currency_ready()
    return currency_cur1 ~= nil and currency_cur1_id == (windower.ffxi.get_player() or {}).id
end

function rem_poke()
    packets.inject(packets.new('outgoing', 0x01A, { ['Target'] = rem.npc_id, ['Target Index'] = rem.npc_index, ['Category'] = 0, ['Param'] = 0 }))
    rem.before = rf_inv_count(rem.item_id)
    rem.phase = 'await_menu'; rem.t = os.clock()
end

function rem_start(msg, from_reforge)
    if not packets_ok then return end
    if rem and rem.active then return end
    if not from_reforge and rf and rf.active then rem_fail('reforge running') return end
    local ch = tonumber(msg.chapter)
    local want = math.floor(tonumber(msg.count) or 1)
    if not ch or ch < 1 or ch > 10 then rem_fail('bad chapter') return end
    want = math.max(1, math.min(want, 255))  -- up to 255 can be stored; a step may need e.g. 10 for a headpiece
    local live = windower.ffxi.get_mob_by_name and windower.ffxi.get_mob_by_name('Monisette')
    local fx = STORE_FIXED_NPCS['Monisette']
    local id, index, zone
    if live and live.id then id, index, zone = live.id, live.index, (windower.ffxi.get_info() or {}).zone
    elseif fx then id, index, zone = fx.id, fx.index, fx.zone end
    if not id then rem_fail('Monisette not found in this zone') return end
    rem = { active = true, ch = ch, item_id = REM_ITEM_BASE + ch, want = want,
        npc_id = id, npc_index = index, zone = zone or 246, phase = 'prep', t = os.clock() }
    alex_chat(207, ('[Alexandria] retrieving %dx Rems Tale Ch.%d'):format(want, ch), 'progress')
end

function rem_tick(now)
    if not rem or not rem.active then return end
    if rem.phase == 'prep' then
        if not rem_near() then rem.status = 'go to Monisette'; return end
        rem_poke()
    elseif rem.phase == 'await_menu' then
        if (os.clock() - (rem.t or now)) > 8 then rem_fail('menu did not open') end
    elseif rem.phase == 'await_item' then
        -- One talk/select pulls the whole requested quantity at once (count is packed into the option),
        -- so wait for all `want` to land in inventory, then finish.
        local got = rf_inv_count(rem.item_id) - (rem.before or 0)
        if got >= rem.want then
            alex_chat(207, ('[Alexandria] retrieved %dx Rems Tale Ch.%d'):format(rem.want, rem.ch), 'progress')
            rem = nil
        elseif (os.clock() - (rem.t or now)) > 8 then
            if got > 0 then
                alex_chat(207, ('[Alexandria] retrieved %dx Rems Tale Ch.%d (wanted %d)'):format(got, rem.ch, rem.want), 'progress')
            else
                rem_fail('chapters did not arrive')
            end
            rem = nil
        end
    end
end

-- Answer Monisette's storage menu (0x181). The option packs BOTH the chapter and the quantity:
-- low byte = chapter (1-10), high byte = how many to withdraw (captures only ever took 1 -> 0x01xx).
-- So `want` chapters come out in a single sequence. Any other menu = wrong event -> option 0 and abort.
function rem_incoming(id, data)
    if not rem or not rem.active or rem.phase ~= 'await_menu' then return nil end
    if id ~= 0x034 and id ~= 0x032 then return nil end
    local ok, p = pcall(packets.parse, 'incoming', data)
    if not (ok and p) then return nil end
    if p['NPC Index'] ~= nil and p['NPC Index'] ~= rem.npc_index then return nil end
    local menu = p['Menu ID']
    if menu ~= REM_MENU then
        packets.inject(packets.new('outgoing', 0x05B, { ['Target'] = rem.npc_id, ['Option Index'] = 0, ['Target Index'] = rem.npc_index, ['Zone'] = rem.zone, ['Menu ID'] = menu or REM_MENU }))
        rem_fail('unexpected menu ' .. tostring(menu))
        return true
    end
    packets.inject(packets.new('outgoing', 0x05B, { ['Target'] = rem.npc_id, ['Option Index'] = rem.want * 256 + rem.ch, ['Target Index'] = rem.npc_index, ['Zone'] = rem.zone, ['Menu ID'] = REM_MENU }))
    rem.phase = 'await_item'; rem.t = os.clock()
    return true
end

windower.register_event('incoming chunk', function(id, data, modified, injected)
    if capture then capture_record('in', id, data) end
    if po_state ~= 0 and packets_ok then
        local ok, r = xpcall(function() return po_incoming(id, data) end, debug.traceback)
        if not ok then pull_log('PO_INCOMING CRASH (id=' .. tostring(id) .. '):\n' .. tostring(r)); r = nil end
        if r ~= nil then return r end
    end
    if aug_active() and packets_ok then
        local r = aug_incoming(id, data)
        if r ~= nil then return r end
    end
    if rf_active() and packets_ok then
        local r = rf_incoming(id, data)
        if r ~= nil then return r end
    end
    if rem_active() and packets_ok then
        local r = rem_incoming(id, data)
        if r ~= nil then return r end
    end
    if gobbie_run and packets_ok then
        local r = gobbie_incoming(id, data)
        if r ~= nil then return r end
    end
    if cbuy and packets_ok then
        local r = cbuy_incoming(id, data)
        if r ~= nil then return r end
    end
    if id == 0x00D then bz_on_charpc(data) return end
    if id == 0x01D or id == 0x01E or id == 0x01F or id == 0x020 then
        if not inv_dirty then inv_first_dirty = os.clock() end
        inv_dirty = true
        inv_dirty_at = os.clock()
        if not slips_dirty then slips_first_dirty = os.clock() end
        slips_dirty = true
        slips_dirty_at = os.clock()
        if resupply_run and resupply_run.state == 'buyack' then resupply_buy_check(resupply_run) end
        return
    end
    if id == 0x055 then ki_dirty = true; ki_dirty_at = os.clock(); return end
    if not packets_ok then return end
    if id == 0x0D2 then
        local p = packets.parse('incoming', data)
        if not p or p.Item == 0 or p.Item == 0xFFFF then return end
        if pool[p.Index] and pool[p.Index].ts == p.Timestamp then return end
        pool[p.Index] = { id = p.Item, ts = p.Timestamp }
        pool_dirty = true
        pool_dirty_at = os.clock()
        pool_check(p.Index, p.Item)
    elseif id == 0x0D3 then
        local p = packets.parse('incoming', data)
        if not p then return end
        if pool[p.Index] then
            if p.Drop ~= 0 then
                pool[p.Index] = nil
                my_lotted[p.Index] = nil
            else
                pool[p.Index].lotter = p['Highest Lotter Name']
                pool[p.Index].lot = p['Highest Lot']
            end
            pool_dirty = true
            pool_dirty_at = os.clock()
        end
    elseif id == 0x0B then
        pool = {}
        my_lotted = {}
        shop_session = false
        shop_sold = {}
        cfarm = nil
        cbuy = nil
        release_pkt = nil
        curio_scan = nil
        resupply_run = nil
        emit_resupply(false, 0, 0, 0, 'done')
        pvendor_run = nil
        pvendor_near = nil
        pvendor_near_dirty = true
        emit_pvendor(false, 0, 0, 0, 'done')
        emit_convert_off()
        pool_dirty = true
        pool_dirty_at = os.clock()
        npc_menu = nil
        npc_near = nil
        npc_near_dirty = true
        npc_pending = nil
        npc_driving = nil
        store_close_until = 0
        aug_reset()
        bz_flags = {}
        bz_collecting = false
        bz_collect = nil
        bz_sweep = nil
        bz_buy = nil
        bz_clear_pending = true
        bz_sweep_dirty = true
        bz_sellers_dirty = true
        if next(shop.items) ~= nil then shop.items = {}; shop_dirty = true end
    elseif id == 0x113 then
        local ok, p = pcall(packets.parse, 'incoming', data)
        if ok and p then
            currency_cur1 = p; currency_cur1_id = (windower.ffxi.get_player() or {}).id
            -- Windower's 0x113 definition is stale and only names Rem's Tale Chapters 1-5, so 6-10 come
            -- back nil (read as 0 stored). They are ten consecutive u8 in the packet (XiPackets: byte
            -- 207..216, 1-indexed), so read all ten from the raw bytes. Only trust the offset if the raw
            -- 1-5 agree with Windower's parse, so a wrong offset can never silently corrupt the counts.
            if #data >= 216 then
                local match = true
                for n = 1, 5 do
                    local wv = p['Rems Tale Chapter ' .. n]
                    if type(wv) == 'number' and wv ~= data:byte(206 + n) then match = false; break end
                end
                if match then
                    for n = 1, 10 do currency_cur1['Rems Tale Chapter ' .. n] = data:byte(206 + n) end
                end
            end
            currency_dirty = true
        end
    elseif id == 0x118 then
        local ok, p = pcall(packets.parse, 'incoming', data)
        if ok and p then currency_cur2 = p; currency_cur2_id = (windower.ffxi.get_player() or {}).id; currency_dirty = true end
    elseif id == 0x04C then
        ah_handle_incoming(data)
    elseif id == 0x04B then
        dbox_handle_incoming(data)
    elseif id == 0x105 then
        if bz_collecting then return bz_incoming_list(data) end
    elseif id == 0x106 then
        if bz_buy then bz_buy_result(data:byte(0x04 + 1) == 0, bz_buy.name, (data:byte(0x04 + 1) == 0) and 'bought' or 'declined') end
    elseif id == 0x03C then
        shop_handle_incoming(data)
        npc_driving = nil
        if resupply_run then resupply_incoming(0x03C) end
    elseif id == 0x03F then
        if resupply_run then resupply_incoming(0x03F) end
    elseif id == 0x052 then
        if store_debug then store_dbg(('0x052 in type=%s armed=%s'):format(tostring(data:byte(0x04 + 1)), tostring(store_close_until > 0))) end
        if store_close_until > 0 and os.clock() < store_close_until then
            store_close_until = 0
            coroutine.schedule(store_menu_close, 0.05)
        end
    elseif id == 0x032 or id == 0x033 or id == 0x034 then
        if npc_menu_handle(data) then return true end
    elseif id == 0x021 or id == 0x022 or id == 0x023 then
        if trade_debug then trade_log(('IN  0x%03X k=%s who=%s ctr=%s'):format(id, tostring(data:byte(9)), tostring(rd_u32(data, 5)), tostring(rd_u16(data, 9))) .. '  ' .. dbox_hex(data)) end
        trade_on_incoming(id, data, injected)
    end
end)

windower.register_event('outgoing chunk', function(id, original, modified, injected)
    if capture then capture_record('out', id, modified or original) end
    -- A real appraise/confirm means the player is working the sell menu by hand. Hold off our
    -- own auto-sell for a few seconds so an injected 0x085 can't confirm the item they are only
    -- price-checking (0x084 appraise and 0x085 confirm share one server-side selected-item slot).
    if not injected and (id == 0x84 or id == 0x85) then shop_manual_until = os.clock() + 5 end
    if trade_debug and (id == 0x032 or id == 0x033 or id == 0x034) then
        local src = modified or original
        trade_log(('OUT 0x%03X %s'):format(id, injected and 'INJ ' or 'REAL') .. dbox_hex(src))
    end
    if id == 0x04D and dbox_debug then
        local src = modified or original
        local ok, p = pcall(packets.parse, 'outgoing', src)
        local meta = (ok and p) and string.format('cmd=%s box=%s post=%s item=%s', tostring(p.Command or p.Type), tostring(p.BoxNo), tostring(p.PostWorkNo or p['Post Work No']), tostring(p.ItemWorkNo or p['Item Work No'])) or ''
        dbox_log(string.format('OUT %s %s', injected and 'INJ ' or 'REAL', meta))
        dbox_log('    ' .. dbox_hex(src))
    end
    if id == 0x036 and store_debug then
        local src = modified or original
        local hex = {}
        for i = 1, #src do hex[#hex + 1] = string.format('%02X', src:byte(i)) end
        alex_chat(160, string.format('[036]%s len=%d %s', injected and ' INJ' or ' REAL', #src, table.concat(hex, ' ')))
    end
    if id == 0x05B and store_debug then
        local src = modified or original
        local hex = {}
        for i = 1, #src do hex[#hex + 1] = string.format('%02X', src:byte(i)) end
        local ok, p = pcall(packets.parse, 'outgoing', src)
        local meta = (ok and p) and string.format(' opt=%s menu=%s tgt=%s tidx=%s', tostring(p['Option Index']), tostring(p['Menu ID']), tostring(p['Target']), tostring(p['Target Index'])) or ''
        alex_chat(160, string.format('[05B]%s len=%d%s', injected and ' INJ' or ' REAL', #src, meta))
        alex_chat(160, table.concat(hex, ' '))
    end
    if sell_log and (id == 0x84 or id == 0x85) then
        local hex = {}
        for i = 1, #original do hex[#hex + 1] = string.format('%02X', original:byte(i)) end
        alex_chat(207, string.format('[sell] 0x%02X%s [%d] %s', id, injected and ' inj' or '', #original, table.concat(hex, ' ')))
    end
    if not injected and cbuy and cbuy.shop == 'sparks' and cbuy.phase == 'buying' then
        local seq = original:unpack('H', 3)
        if cbuy_last_seq ~= seq then cbuy_last_seq = seq; cbuy_buy_one() end
    end
    if id == 0x05B and not injected then
        if po_state ~= 0 then po_state = 3 end
        local ok, p = pcall(packets.parse, 'outgoing', original)
        if ok and p and p['Menu ID'] then
            npc_last_select = { menu = p['Menu ID'], option = p['Option Index'] or 0, target = p['Target'], t = os.clock() }
        end
    elseif id == 0x041 then
        local idx = original:byte(5)
        if idx then
            my_lotted[idx] = true
            if pool_pass_on_lot then windower.send_ipc_message('axlot ' .. idx) end
        end
    end
end)

windower.register_event('ipc message', function(msg)
    if type(msg) == 'string' and msg:sub(1, 6) == 'axlot ' then
        pool_ipc_pass(tonumber(msg:sub(7)))
    end
end)

windower.register_event('status change', function(new, old)
    if old == 4 and new == 0 then
        store_released = true
        if store_debug and store_run then store_dbg('status 4->0 (released)') end
    end
end)

windower.register_event('login', function()
    rf_paused_checked = false; rf_paused = nil; rf_dirty = true   -- reload the paused reforge for the new character
end)

prof_on = false
prof = {}
prof_frames = 0
function prof_mark(name, t0)
    local dt = (os.clock() - t0) * 1000
    local e = prof[name]
    if not e then e = { t = 0, n = 0, mx = 0 }; prof[name] = e end
    e.t = e.t + dt; e.n = e.n + 1
    if dt > e.mx then e.mx = dt end
end
function PF(name, fn, arg)
    if not prof_on then return fn(arg) end
    local t0 = os.clock()
    local r = fn(arg)
    prof_mark(name, t0)
    return r
end

function mem_status_line()
    local pl = windower.ffxi.get_player()
    return ('%s  char=%s  lua=%.0fKB  txbuf=%d  act=%d  dropq=%d  dropmoveq=%d'):format(
        os.date('%H:%M:%S'), tostring(pl and pl.name), collectgarbage('count'), #txbuf,
        (type(act_queue) == 'table' and #act_queue or -1),
        (type(drop_q) == 'table' and #drop_q or -1),
        (type(drop_move_q) == 'table' and #drop_move_q or -1))
end

function mem_log_write(line)
    local f = io.open(windower.addon_path .. 'data/mem.txt', 'a')
    if f then f:write(line .. '\n'); f:close() end
end

function mem_log_sample()
    local ok, line = pcall(mem_status_line)
    if ok then mem_log_write(line) end
end

-- ===== Self-trigger channel =====================================================================
-- Lets an external driver run organize/preview/reload without the desktop app pressing the button.
-- Preview/organize REPLAY the last rules the desktop sent (cached in memory + persisted to
-- debug/last_org.json so they survive a //lua reload); routing (name->ids, layout_map) is recomputed
-- from those rules every run, so an addon-side fix is validated just by writing "preview". Control file
-- debug/trigger.txt holds one word: "preview" | "organize" | "reload". It fires once, then is deleted.
org_last_rules = nil
org_trigger_t = 0
function org_cache_rules(msg)
    org_last_rules = msg
    if not json_ok then return end
    local ok, raw = pcall(json.encode, msg)
    if not ok or type(raw) ~= 'string' then return end
    local base = windower.addon_path .. 'debug'
    if windower.dir_exists and not windower.dir_exists(base) then windower.create_dir(base) end
    local f = io.open(base .. '/last_org.json', 'w')
    if f then f:write(raw); f:close() end
end
function org_trigger_check(now)
    if (now - org_trigger_t) < 1.0 then return end
    org_trigger_t = now
    local base = windower.addon_path .. 'debug'
    local path = base .. '/trigger.txt'
    local f = io.open(path, 'r')
    if not f then return end
    local cmd = (f:read('*a') or ''):gsub('%s+', ''):lower()
    f:close()
    os.remove(path)   -- fire exactly once
    if cmd == '' then return end
    if cmd == 'reload' then windower.send_command('lua r Alexandria'); return end
    if cmd ~= 'preview' and cmd ~= 'organize' then return end
    local rules = org_last_rules
    if not rules and json_ok then
        local lf = io.open(base .. '/last_org.json', 'r')
        if lf then
            local raw = lf:read('*a'); lf:close()
            local ok, m = pcall(json.decode, raw)
            if ok and type(m) == 'table' then rules = m; org_last_rules = m end
        end
    end
    org_debug = true   -- a self-triggered run always emits debug/organize_snapshot.json for the analyzer
    if rules and not org_active then do_organize(rules, cmd == 'preview') end
end

-- Authoritative "past the loading screen and playable" check (mirrors Project Cadmus IS_LOADED): on a load
-- screen get_player() is nil; at the TAIL of a zone-in get_player() can repopulate BEFORE the local player
-- entity is placed in the mob array, so also require the player mob to exist with a real (non-0,0,0) position.
-- A non-zero zone id rules out the sentinel transient. This is the state that was still injecting and crashing.
function is_loaded()
    local p = windower.ffxi.get_player()
    if not p or not p.id then return false end
    local info = windower.ffxi.get_info()
    if not info or not info.logged_in or (info.zone or 0) == 0 then return false end
    local mob = windower.ffxi.get_mob_by_id(p.id)
    if not mob or not mob.x or (mob.x == 0 and mob.y == 0 and mob.z == 0) then return false end
    return true
end

-- Safe only when fully in-world (is_loaded), idle or engaged (not cutscene/dead/mounted), and AUTO_SETTLE
-- seconds have passed SINCE the world finished loading (loaded_since, reset to 0 on every zone / whenever we
-- fall out of the loaded state). Gates every periodic auto injector.
function world_ready(now)
    if loaded_since == 0 then return false end
    if (now - loaded_since) < AUTO_SETTLE then return false end
    local p = windower.ffxi.get_player()
    return p and (p.status == 0 or p.status == 1) or false
end

windower.register_event('zone change', function()
    loaded_since = 0         -- force a fresh settle after the new zone finishes loading
    shop_session = false     -- any open shop is gone after a zone
    shop_sold = {}
end)

function alex_prerender()
    local now = os.clock()
    -- Track when the world finished loading: stamp on the first fully-loaded frame, reset to 0 the moment we
    -- fall out of the loaded state (load screen / mid-zone). The auto-action buffer counts from this stamp.
    if is_loaded() then if loaded_since == 0 then loaded_since = now end else loaded_since = 0 end
    org_trigger_check(now)   -- self-trigger channel (runs even while the desktop is disconnected)
    if prof_on then prof_frames = prof_frames + 1 end
    if mem_log_on and (now - mem_sample_t) >= mem_log_interval then
        mem_sample_t = now
        mem_log_sample()
    end

    if trade_tx then trade_tx_tick(now) end
    if trade_rx and not trade_rx.opened and not trade_rx.tried and now - trade_rx_t > 1.0 then trade_rx.tried = true; trade_kind(0) end
    if trade_rx and now - trade_rx_t > TRADE_TIMEOUT then trade_rx = nil end
    if trade_armed and now - trade_armed.t > TRADE_ARM_WINDOW then trade_armed = nil end
    if trade_status_dirty then trade_status_dirty = false; queue_send(build_tradestatus()); trade_result = nil end

    if icon_ok and (now - icon_drain_t) >= 0.25 then
        icon_drain_t = now
        local batch = icon_bulk and 30 or 5
        for _ = 1, batch do
            local id = next(icon_queue)
            if not id then
                if icon_bulk then
                    icon_bulk = false
                    queue_send('{"t":"iconjob","done":' .. icon_bulk_total .. ',"total":' .. icon_bulk_total .. ',"running":false}\n')
                end
                break
            end
            icon_queue[id] = nil
            coroutine.schedule(function() pcall(icon_extractor.item_by_id, id, icon_prefix .. id .. '.bmp') end, 0)
        end
        if icon_bulk and (now - icon_bulk_t) >= 1 then
            icon_bulk_t = now
            local remaining = 0
            for _ in pairs(icon_queue) do remaining = remaining + 1 end
            queue_send('{"t":"iconjob","done":' .. (icon_bulk_total - remaining) .. ',"total":' .. icon_bulk_total .. ',"running":true}\n')
        end
    end

    if not connected then
        poll_pending_connect(now)
        if not conn_pending and (now - last_try) >= retry_delay then
            last_try = now
            try_connect()
        end
        return
    end

    local chunk, err, partial = conn:receive('*a')
    local data = chunk or partial
    if data and #data > 0 then
        rx = rx .. data
        while true do
            local nl = rx:find('\n', 1, true)
            if not nl then break end
            local line = rx:sub(1, nl - 1)
            rx = rx:sub(nl + 1)
            if #line > 0 then dispatch(line) end
        end
        if #rx > TXBUF_MAX then rx = '' end
    end
    if err == 'closed' then
        disconnect()
        return
    end

    -- Announce a character swap the instant the player id changes, rather than waiting up to
    -- SEND_INTERVAL for the next 'self'. Identity MUST reach the desktop before the incoming
    -- character's loading inventory, or the desktop pins those bags onto the character that
    -- just logged out (the shared-client corruption). Then force a fresh inventory so the
    -- new character's real bags follow its identity.
    local pcur = windower.ffxi.get_player()
    local pid_cur = pcur and pcur.id or 0
    if pid_cur ~= last_self_id then
        last_self_id = pid_cur
        inv_sig_last = ''
        if pid_cur ~= 0 then
            last_send = now
            queue_send(build_self('self'))
            queue_send(build_party())
            inv_dirty = true
            inv_dirty_at = now - INV_DEBOUNCE
        end
    end

    if now - last_send >= SEND_INTERVAL then
        last_send = now
        local st = os.clock()
        queue_send(build_self('self'))
        local pf = build_party()
        queue_send(pf)
        if prof_on then prof_mark('build_self+party', st) end
    end

    -- Fast lane: burst plain item moves with no throttle, capped per frame.
    if #move_queue > 0 then
        local n = 0
        while n < MOVE_BURST and #move_queue > 0 do
            local fn = table.remove(move_queue, 1)
            if fn then pcall(fn) end
            n = n + 1
        end
    end
    -- Organize lane: one paced move per ORG_MOVE_DELAY so the game acks each before
    -- the next is sent (bursting them made the game drop all but the first).
    if #org_move_queue > 0 and (now - org_move_t) >= ORG_MOVE_DELAY then
        org_move_t = now
        local fn = table.remove(org_move_queue, 1)
        if fn then pcall(fn) end
    end
    -- Throttled lane: one packet-based action per ACT_DELAY.
    if #act_queue > 0 and (now - act_t) >= ACT_DELAY then
        act_t = now
        local fn = table.remove(act_queue, 1)
        if fn then pcall(fn) end
    end

    if #move_queue == 0 and next(move_dirty_bags) then
        for bag, _ in pairs(move_dirty_bags) do
            local b = bag
            enqueue_fast(function() windower.ffxi.stack_items(b) end)
        end
        move_dirty_bags = {}
    end

    drain_drops(now)
    drain_pool()

    -- No background AH polling: slot status is fetched on demand only, when the
    -- desktop opens the Market view (ahslots/ahmenu). Here we just drop a stale
    -- box once you walk away from the counter so the app doesn't show old slots.
    if (now - ah_auto_t) >= 4 then
        ah_auto_t = now
        if not ah_at_ah() and (ah_initialized or ah_box) then
            ah_initialized = false
            ah_box = nil
            ah_dirty = true
        end
    end

    -- Strictly sequential, confirmation-gated: only release the next AH action
    -- when the previous one has been answered (ah_busy cleared) and the minimum
    -- spacing has elapsed. A timeout unsticks us if the server never replies.
    if ah_busy and (now - ah_busy_t) >= AH_BUSY_TIMEOUT then
        ah_busy = false
    end
    if #ah_queue > 0 and not ah_busy and now >= ah_t then
        -- Hard gate at the single point every AH packet leaves the client: if we are no longer at an auction
        -- house (walked away / zoned after queuing), DROP the queue instead of firing 0x4E packets that the
        -- game answers with "auction house is temporarily closed". Never transmit an AH action off-site.
        if not ah_usable() then
            ah_queue = {}
            ah_busy = false
            ah_dirty = true
        else
            local fn = table.remove(ah_queue, 1)
            if fn then
                local ok, ran = pcall(fn)
                if ok and ran then
                    ah_t = now + AH_DELAY
                    ah_busy = true
                    ah_busy_t = now
                end
            end
            ah_dirty = true
        end
    end

    if ah_dirty then
        ah_dirty = false
        queue_send(build_ah())
    end

    if dbox_dirty then
        dbox_dirty = false
        queue_send(build_dbox())
    end

    local dbst = os.clock()
    dbox_open_tick(now)
    dbox_autoref_tick(now)
    dbox_tick(now)
    dbox_pq_drain(now)
    if prof_on then prof_mark('dbox_ticks', dbst) end
    if dbox_status_dirty then
        dbox_status_dirty = false
        queue_send(build_dbox_status())
    end

    if shop_dirty then
        shop_dirty = false
        queue_send(build_shop())
    end

    if npc_driving and (now - npc_driving.t) > 6 then npc_driving = nil end
    PF('npc_scan', npc_scan, now)
    PF('resupply_tick', resupply_tick, now)
    PF('pvendor_tick', pvendor_tick, now)
    PF('cfarm_tick', cfarm_tick, now)
    PF('curio_scan_tick', curio_scan_tick, now)
    PF('store_tick', store_tick, now)
    PF('store_drop_tick', store_drop_tick, now)
    PF('gobbie_tick', gobbie_tick, now)
    local store_zid = (windower.ffxi.get_info() or {}).zone or 0
    if store_zid ~= 0 then
        if store_zid ~= store_last_zone then store_last_zone = store_zid; store_npc_cache = {}; store_dirty = true end
        if store_dirty then
            store_dirty = false
            queue_send(build_storezone())
            queue_send(build_store())
        end
    end
    if npc_near_dirty then
        npc_near_dirty = false
        queue_send(build_npcnear())
    end
    if fixed_near_dirty then
        fixed_near_dirty = false
        queue_send(build_fixednear())
    end

    if npc_learn_dirty then
        npc_learn_dirty = false
        if npc_learn then
            queue_send('{"t":"npclearn","npc":"' .. esc(npc_learn.npc) .. '","option":' .. npc_learn.option .. '}\n')
        end
    end

    if ah_err_pending and (now - ah_err_pending.t) >= AH_ERR_DEFER then
        ah_listed(false, ah_err_pending.id, 0, 0, ah_err_pending.reason)
        ah_err_pending = nil
    end

    ah_stream_catalog()

    if use_pending then
        local up = use_pending
        local arrived = shop_count_inv(up.id) - up.before
        if arrived >= up.qty then
            use_pending = nil
            start_use(up.id, up.all)
        elseif now - up.t > 8 then
            use_pending = nil
            if arrived > 0 then start_use(up.id, up.all) end
        end
    end

    if use_id and use_left > 0 and now >= use_next then
        local player = windower.ffxi.get_player()
        if not player or not (player.status == 0 or player.status == 1) then
            use_next = now + 1
        else
            local inv = windower.ffxi.get_items(0)
            local have = 0
            if inv then
                for s = 1, (inv.max or 80) do
                    local it = inv[s]
                    if type(it) == 'table' and it.id == use_id and it.status == 0 then have = have + (it.count or 0) end
                end
            end
            -- Temporary items can't be moved into inventory but /item uses them in place,
            -- so holding one in the Temporary bag (3) counts as usable right now.
            local temp = windower.ffxi.get_items(3)
            local temp_have = 0
            if type(temp) == 'table' then
                for s = 1, (temp.max or 80) do
                    local it = temp[s]
                    if type(it) == 'table' and it.id == use_id and (it.status or 0) == 0 then temp_have = temp_have + (it.count or 0) end
                end
            end
            if have > 0 or temp_have > 0 then
                windower.chat.input('/item "' .. use_name .. '" <me>')
                use_left = use_left - 1
                use_done = use_done + 1
                use_move_at = 0
                use_next = now + use_delay
                if use_left <= 0 then emit_use(false); use_id = nil else emit_use(true) end
            elseif use_move_at > 0 and (now - use_move_at) < 3 then
                use_next = now + 0.5
            elseif use_pull_stack(use_id) then
                use_move_at = now
                use_next = now + 1.0
            else
                emit_use(false); use_id = nil; use_left = 0
            end
        end
    end

    if org_active then
        -- Complete when every step has reported, not when the shared queue drains
        -- (a throttled seqack sitting behind the moves would otherwise stall it).
        if org_done >= org_total then
            org_active = false
            if org_verify and not org_verify.done_at then org_verify.done_at = now; org_verify.moved = org_moved; org_verify.total = org_total end
            local skipped = org_total - org_moved
            if skipped > 0 then
                alex_chat(207, '[Alexandria] auto-organize complete: ' .. org_moved .. ' moved, ' .. skipped .. ' skipped (bag full?)', 'progress')
            else
                alex_chat(207, '[Alexandria] auto-organize complete: ' .. org_moved .. ' moved', 'progress')
            end
            queue_send(build_orgstatus())
        else
            if (now - org_report_t) >= 3.0 then
                org_report_t = now
                alex_chat(207, '[Alexandria] organizing... ' .. org_done .. '/' .. org_total, 'progress')
            end
            if (now - org_stream_t) >= 0.4 then
                org_stream_t = now
                queue_send(build_orgstatus())
            end
        end
    end

    -- Post-run verify (debug log only): a settle after the paced moves finish, re-read
    -- each planned item's source bag and record how many ACTUALLY left vs what the run
    -- claimed. This is what exposes silent drops ("reported moved 8, really moved 1").
    if org_verify and org_verify.done_at and (now - org_verify.done_at) >= 1.5 then
        local v = org_verify
        org_verify = nil
        local function count_in(bag, id)
            local items = windower.ffxi.get_items(bag)
            local n = 0
            if type(items) == 'table' then for s = 1, (items.max or 0) do local it = items[s]; if it and it.id == id then n = n + (it.count or 1) end end end
            return n
        end
        local dbg = { ('POST-RUN %s: reported moved=%d/%d, verifying what actually landed:'):format(v.ts, v.moved, v.total) }
        local landed = 0
        for _, s in ipairs(v.steps) do
            local src_now = count_in(s.from, s.id)
            local moved = s.src_before - src_now
            if moved >= s.want then landed = landed + 1 end
            local tag = (moved >= s.want) and 'OK' or (moved > 0 and 'PARTIAL' or 'FAIL(still in source)')
            dbg[#dbg + 1] = ('  %s: src[%d] %d->%d  moved %d/%d  %s'):format(s.n, s.from, s.src_before, src_now, moved, s.want, tag)
        end
        dbg[#dbg + 1] = ('VERIFIED %d/%d steps fully landed'):format(landed, #v.steps)
        org_log_write(dbg)
    end

    if inv_dirty and (now - inv_dirty_at >= INV_DEBOUNCE or now - inv_first_dirty >= 1.5) then
        inv_dirty = false
        store_dirty = true
        local sst = os.clock()
        local sig = inv_signature()
        if prof_on then prof_mark('inv_signature', sst) end
        if sig ~= inv_sig_last then
            inv_sig_last = sig
            local ist = os.clock()
            local invf = build_inventory()
            if invf then queue_send(invf) end
            if prof_on then prof_mark('build_inventory', ist) end
        end
        -- Auto packet actions must NEVER fire mid-zone / on the loading screen: inventory reloads on zone-in
        -- and would burst-inject sort/drop/sell before the player is in-world, which can crash the client.
        if world_ready(now) then
            if next(autosort_bags) then autosort_check() end
            if auto_drop then scan_drops() end
            if clean_set then if now < clean_until then scan_drops(clean_set) else clean_set = nil end end
            if (sell_anywhere and in_town()) or (shop_session and shop_autosell) then shop_autosell_run() end
            if cfarm then cfarm_sell(cfarm.item) end
        elseif clean_set and now >= clean_until then
            clean_set = nil   -- let a timed clean expire even while auto actions are held
        end
    end

    if ki_dirty and now - ki_dirty_at >= 1.0 then
        ki_dirty = false
        local s = build_keyitems()
        if s ~= ki_last then ki_last = s; queue_send(s) end
    end

    if pool_dirty and now - pool_dirty_at >= INV_DEBOUNCE then
        pool_dirty = false
        queue_send(build_pool())
    end


    if slips_dirty and (now - slips_dirty_at >= 1.0 or now - slips_first_dirty >= 2.5) then
        slips_dirty = false
        local ok, out = xpcall(build_slips, debug.traceback)
        if ok then queue_send(out) else pull_log('BUILD_SLIPS CRASH:\n' .. tostring(out)) end
    end

    if po_consolidate_state then
        local cs = po_consolidate_state
        local ready = true
        for id in pairs(cs.waiting) do
            if not find_in_bag(0, id) then ready = false break end
        end
        if ready or (now - cs.t) > 12 then
            po_consolidate_state = nil
            pcall(cs.cb)
        end
    end

    if shop_pending_sell then
        local ps = shop_pending_sell
        local arrived = shop_count_inv(ps.id) - ps.before
        if arrived >= ps.qty then
            shop_pending_sell = nil
            shop_sell_amount(ps.id, ps.qty)
        elseif now - ps.t > 8 then
            shop_pending_sell = nil
            if arrived > 0 then shop_sell_amount(ps.id, arrived) end
        end
    end

    if drop_pending then
        local dp = drop_pending
        local cur = shop_count_inv(dp.id)
        if dp.phase == 'confirm' then
            if cur <= dp.floor or now - dp.t > 8 then
                drop_pending = nil
            end
        else
            local arrived = cur - dp.before
            if arrived >= dp.qty then
                drop_amount(dp.id, dp.qty)
                dp.phase = 'confirm'; dp.floor = dp.before; dp.t = now
            elseif now - dp.t > 8 then
                if arrived > 0 then
                    drop_amount(dp.id, arrived)
                    dp.phase = 'confirm'; dp.floor = dp.before; dp.t = now
                else
                    drop_pending = nil
                end
            end
        end
    end
    pump_drop_moves()

    if po_progress_dirty then
        po_progress_dirty = false
        queue_send(build_porter())
    end

    if porter_near_dirty then
        porter_near_dirty = false
        queue_send('{"t":"portermoogle","near":' .. (porter_near and 'true' or 'false') .. '}\n')
    end

    if vendor_near_dirty then
        vendor_near_dirty = false
        queue_send('{"t":"vendornear","sparks":' .. (sparks_near and 'true' or 'false') .. ',"unity":' .. (unity_near and 'true' or 'false') .. ',"curio":' .. (curio_near and 'true' or 'false') .. '}\n')
    end

    if cfarm_dirty then
        cfarm_dirty = false
        local cf = build_convert()
        if cf then queue_send(cf) end
    end

    if resupply_dirty then
        resupply_dirty = false
        local rf = build_resupply()
        if rf then queue_send(rf) end
    end

    if pvendor_near_dirty then
        pvendor_near_dirty = false
        queue_send(build_pvendornear())
    end

    if pvendor_dirty then
        pvendor_dirty = false
        local pf = build_pvendor()
        if pf then queue_send(pf) end
    end

    PF('aug_tick', aug_tick, now)
    if aug_dirty then
        aug_dirty = false
        queue_send(build_aug())
    end
    if aug_info_dirty then
        aug_info_dirty = false
        queue_send(build_auginfo())
    end
    PF('rf_tick', rf_tick, now)
    if rem then PF('rem_tick', rem_tick, now) end
    -- Once the player is known (post-login), load any paused reforge saved for this character so the
    -- desktop can offer to resume it. Cheap one-shot; reset on login for a character swap.
    if not rf_paused_checked and not rf then
        local me = windower.ffxi.get_player()
        if me and me.name then rf_paused_checked = true; rf_load_paused() end
    end
    -- Emit a reforge frame on ANY state change, not only when a code path remembered to set rf_dirty.
    -- Several prep/wait status transitions (go-to-NPC, gathering, waiting) return without dirtying, which
    -- froze the desktop panel on a stale countdown. Diffing the built frame guarantees the UI tracks the
    -- true state; identical frames are suppressed so we never spam the socket. Only build while a reforge
    -- exists (or dirty forces the one-shot inactive frame) so an idle client does no per-tick work.
    if rf or rf_paused or rf_dirty then
        local rframe = build_reforge()
        if rf_dirty or rframe ~= rf_last_frame then
            rf_dirty = false; rf_last_frame = rframe
            queue_send(rframe)
        end
    end

    PF('bz_tick', bz_tick, now)
    if bz_sellers_dirty then
        bz_sellers_dirty = false
        queue_send(build_bzsellers())
    end
    if bz_items_dirty then
        bz_items_dirty = false
        queue_send(build_bzitems())
    end
    if bz_my_dirty then
        bz_my_dirty = false
        queue_send(build_bzmy())
    end
    if bz_sweep_dirty then
        bz_sweep_dirty = false
        queue_send(build_bzscan())
    end
    if bz_buy_dirty then
        bz_buy_dirty = false
        queue_send(build_bzbuy())
    end
    if bz_clear_pending then
        bz_clear_pending = false
        queue_send('{"t":"bzclear"}\n')
    end

    if currency_dirty then
        currency_dirty = false
        queue_send(build_currency())
    end

    if #txbuf >= TXBUF_MAX then
        alex_chat(207, '[Alexandria] app not responding; resetting connection', 'error')
        disconnect()
        return
    end
    if #txbuf > 0 then
        local sent, serr, last = conn:send(txbuf)
        local n = sent or last
        if n and n > 0 then txbuf = txbuf:sub(n + 1) end
        if serr == 'closed' then disconnect() return end
    end
    sage_tick(now)   -- Sage master-overlay fan-out (tee frames + read pool commands)
    if prof_on then prof_mark('TOTAL_FRAME', now) end
end

-- Wrap the whole frame so a single bad call (e.g. a lib table.it crash) can't abort the loop every frame,
-- which silently stalls the move queue and spams chat. Capture the full stack once so the culprit is exact.
alex_prerender_crashes = 0
windower.register_event('prerender', function()
    local ok, err = xpcall(alex_prerender, debug.traceback)
    if not ok then
        alex_prerender_crashes = alex_prerender_crashes + 1
        if alex_prerender_crashes <= 5 then pull_log('PRERENDER CRASH #' .. alex_prerender_crashes .. ':\n' .. tostring(err)) end
    end
end)

function ax_forward(a)
    if not connected then
        alex_chat(207, '[Alexandria] app not running; cannot run commands', 'error')
        return false
    end
    local parts = {}
    for i = 1, #a do parts[i] = '"' .. esc(tostring(a[i])) .. '"' end
    local me = windower.ffxi.get_player()
    local tgt = windower.ffxi.get_mob_by_target('t')
    local extra = (tgt and tgt.name) and (',"target":"' .. esc(tgt.name) .. '"') or ''
    queue_send('{"t":"axcmd","char":"' .. esc(me and me.name or '') .. '"' .. extra .. ',"args":[' .. table.concat(parts, ',') .. ']}\n')
    return true
end

COMPAT = {
    find    = { group = 'find' },
    findall = { group = 'find' },
    get     = { group = 'item' },
    gets    = { group = 'item' },
    put     = { group = 'item' },
    puts    = { group = 'item' },
    move    = { group = 'item' },
    moves   = { group = 'item' },
    stack   = { group = 'item' },
    ah      = { group = 'ah' },
    bazaar  = { group = 'ah' },
    org     = { group = 'native', as = 'organize' },
    lorg    = { group = 'native', as = 'light-organize' },
    con     = { group = 'native', as = 'consolidate' },
    wl      = { group = 'native', as = 'watch' },
    organize    = { group = 'native' },
    consolidate = { group = 'native' },
    use     = { group = 'native' },
    trade   = { group = 'native' },
    drop    = { group = 'native' },
    lot     = { group = 'native' },
    pass    = { group = 'native' },
    lotall  = { group = 'native' },
    passall = { group = 'native' },
    done    = { group = 'native' },
    watch   = { group = 'native' },
    seq     = { group = 'native' },
    dbox   = { group = 'ah', mode = 'dbox', dir = 'in' },
    inbox  = { group = 'ah', mode = 'dbox', dir = 'in' },
    ibox   = { group = 'ah', mode = 'dbox', dir = 'in' },
    obox   = { group = 'ah', mode = 'dbox', dir = 'out' },
    outbox = { group = 'ah', mode = 'dbox', dir = 'out' },
}

windower.register_event('addon command', function(...)
    local a = {...}
    local cmd = (a[1] or ''):lower()
    if cmd == 'compat' then
        local grp = (a[2] or ''):lower()
        local val = (a[3] or ''):lower()
        if grp == '' then
            alex_chat(207, ('[Alexandria] compat find=%s item=%s ah=%s native=%s'):format(
                tostring(settings.compat.find), tostring(settings.compat.item),
                tostring(settings.compat.ah), tostring(settings.compat.native)))
        elseif settings.compat[grp] ~= nil and (val == 'on' or val == 'off') then
            settings.compat[grp] = (val == 'on')
            settings:save()
            alex_chat(207, ('[Alexandria] compat %s = %s'):format(grp, val))
        else
            alex_chat(207, '[Alexandria] usage: //ax compat <find|item|ah|native> <on|off>')
        end
    elseif cmd == 'status' or cmd == '' then
        alex_chat(207, '[Alexandria] ' .. (connected and 'connected to app' or 'app not running'))
    elseif cmd == 'sync' then
        inv_dirty = true
        inv_dirty_at = os.clock() - INV_DEBOUNCE
    elseif cmd == 'orglog' then
        local sub = (a[2] or ''):lower()
        if sub == 'off' then
            org_debug = false
            alex_chat(207, '[Alexandria] organize debug log OFF')
        elseif sub == 'clear' then
            local base = windower.addon_path .. 'debug'
            if windower.dir_exists and not windower.dir_exists(base) then windower.create_dir(base) end
            local f = io.open(base .. '/organize.log', 'w')
            if f then f:close() end
            alex_chat(207, '[Alexandria] organize log cleared (debug/organize.log)')
        else
            org_debug = true
            alex_chat(207, '[Alexandria] organize debug log ON -> debug/organize.log (logs each Organize plan + verifies what actually landed). //ax orglog off to stop.')
        end
    elseif cmd == 'store' then
        local sub = (a[2] or ''):lower()
        if sub == 'batch' then
            local npc, n = a[3], tonumber(a[4])
            if npc and n and n >= 1 then
                local d = store_discovered[npc]
                if type(d) == 'table' then
                    d.batch = (n > 1) and n or nil
                    if STORE_FIXED_NPCS[npc] then STORE_FIXED_NPCS[npc].batch = d.batch end
                    store_save_discovered()
                    store_dirty = true
                    alex_chat(207, ('[Alexandria] %s now stores in batches of %s'):format(npc, tostring(d.batch or 'any')), 'action')
                else
                    alex_chat(207, ('[Alexandria] no discovered NPC named "%s" (capture it first)'):format(tostring(npc)), 'error')
                end
            else
                alex_chat(207, '[Alexandria] usage: //ax store batch <NpcName> <count>')
            end
        elseif sub == 'export' then
            local lines, n = {}, 0
            for name, e in pairs(store_discovered) do
                if type(e) == 'table' and not STORE_DEFAULTS[name] and e.id and e.index and e.zone then
                    local ids, names = {}, {}
                    for _, iid in ipairs(e.items or {}) do
                        ids[#ids + 1] = tostring(iid)
                        names[#names + 1] = (res.items[iid] and res.items[iid].en) or ('item ' .. iid)
                    end
                    local bpart = e.batch and (', batch = ' .. e.batch) or ''
                    lines[#lines + 1] = ("    ['%s'] = { zone = %d, id = %d, index = %d, items = { %s }%s },  -- %s"):format(
                        name, e.zone, e.id, e.index, table.concat(ids, ', '), bpart, table.concat(names, ', '))
                    n = n + 1
                end
            end
            if n == 0 then
                alex_chat(207, '[Alexandria] no new captured NPCs to export (all are already built in)')
            else
                table.sort(lines)
                local base = windower.addon_path .. 'debug'
                if windower.dir_exists and not windower.dir_exists(base) then windower.create_dir(base) end
                local f = io.open(base .. '/store_export.txt', 'w')
                if f then f:write(table.concat(lines, '\n') .. '\n'); f:close() end
                alex_chat(207, ('[Alexandria] exported %d NPC(s) to debug/store_export.txt -- send that file to the developer'):format(n))
            end
        else
            alex_chat(207, '[Alexandria] usage: //ax store batch <NpcName> <count>  |  //ax store export')
        end
    elseif cmd == 'bags' then
        local info = windower.ffxi.get_info()
        alex_chat(207, ('[Alexandria] mog_house=%s zone=%s'):format(tostring(info and info.mog_house), tostring(info and info.zone)))
        for _, b in ipairs({ { 1, 'Safe' }, { 2, 'Storage' }, { 4, 'Locker' }, { 9, 'Safe2' }, { 5, 'Satchel' } }) do
            local items = windower.ffxi.get_items(b[1])
            local en = type(items) == 'table' and items.enabled
            local cnt = type(items) == 'table' and items.count
            alex_chat(207, ('[Alexandria] %s(%d) enabled=%s count=%s'):format(b[2], b[1], tostring(en), tostring(cnt)))
        end
    elseif cmd == 'colortest' then
        local line = ''
        local cnt = 0
        for n = 1, 508 do
            line = line .. ax_col(string.format('%03d', n), n) .. ' '
            cnt = cnt + 1
            if cnt % 12 == 0 then windower.add_to_chat(1, line) line = '' end
        end
        if line ~= '' then windower.add_to_chat(1, line) end
        alex_chat(nil, '[Alexandria] color swatches printed; give me the numbers you want', 'action')
    elseif cmd == 'selllog' then
        sell_log = not sell_log
        alex_chat(207, '[Alexandria] sell packet log ' .. (sell_log and 'ON' or 'OFF'))
    elseif cmd == 'storedebug' then
        store_debug = not store_debug
        alex_chat(207, '[Alexandria] store/gobbie debug log ' .. (store_debug and 'ON (phases + packets print to chat)' or 'OFF'))
    elseif cmd == 'npcinfo' then
        local t = windower.ffxi.get_mob_by_target('t')
        if not t or not t.id then
            alex_chat(207, '[Alexandria] npcinfo: target an NPC first')
        else
            local dz = math.floor(t.id / 4096) % 512
            alex_chat(207, ('[Alexandria] NPC %s id=%d index=%d zone=%d (live %s) dist=%.1f'):format(
                tostring(t.name), t.id, t.index or -1, dz, tostring((windower.ffxi.get_info() or {}).zone), t.distance and math.sqrt(t.distance) or -1))
            alex_chat(207, ("    ['%s'] = { zone = %d, id = %d, index = %d },"):format(tostring(t.name), dz, t.id, t.index or -1))
        end
    elseif cmd == 'party' then
        local pt = windower.ffxi.get_party()
        if type(pt) ~= 'table' then
            alex_chat(207, '[party] get_party returned ' .. type(pt))
        else
            for i = 0, 5 do
                local m = pt['p' .. i]
                if type(m) == 'table' then
                    alex_chat(207, ('[party] p%d name=%s mobname=%s zone=%s'):format(
                        i, tostring(m.name), tostring(m.mob and m.mob.name), tostring(m.zone)))
                end
            end
            for k, v in pairs(pt) do
                if type(v) ~= 'table' then alex_chat(207, ('[party] %s=%s'):format(tostring(k), tostring(v))) end
            end
            local _, pk = build_party()
            alex_chat(207, '[party] computed key=[' .. tostring(pk) .. ']')
        end
    elseif cmd == 'mem' then
        local ok, info = pcall(mem_status_line)
        if ok then
            mem_log_write(info)
            alex_chat(207, '[Alexandria] mem: ' .. info)
        end
    elseif cmd == 'memlog' then
        local sub = (a[2] or ''):lower()
        if sub == 'off' then
            mem_log_on = false
            alex_chat(207, '[Alexandria] memory logging OFF')
        else
            mem_log_on = true
            mem_sample_t = 0
            local iv = tonumber(sub)
            if iv and iv >= 30 then mem_log_interval = iv end
            alex_chat(207, '[Alexandria] memory logging ON (every ' .. mem_log_interval .. 's -> data/mem.txt)')
        end
    elseif cmd == 'capture' then
        local sub = (a[2] or ''):lower()
        if sub == 'start' then
            local zinfo = windower.ffxi.get_info()
            capture = { t0 = os.clock(), events = {}, npc = {}, items = {}, zone = (zinfo and zinfo.zone) or 0, label = a[3], batch = tonumber(a[4]) }
            local tgt = windower.ffxi.get_mob_by_target('t')
            if tgt and tgt.name and tgt.name ~= '' then capture.tname = tgt.name; capture.tid = tgt.id; capture.tindex = tgt.index end
            alex_chat(207, '[Alexandria] capture ON (//ax capture start [label] [batch] for nameless/batched NPCs). Target + trade, click through, then //ax capture stop', 'action')
        elseif sub == 'cancel' then
            capture = nil
            alex_chat(207, '[Alexandria] capture cancelled')
        else
            if not capture then
                alex_chat(207, '[Alexandria] capture not running; //ax capture start first', 'error')
            else
                local c = capture; capture = nil
                local r = store_capture_commit(c, true)  -- record packets only; NEVER register a storage NPC (that is //ax learn)
                local npcname, eid, eidx, item_names, primary = r.npcname, r.eid, r.eidx, r.item_names, r.primary

                local lines = {}
                lines[#lines + 1] = ('when=%s  zone=%d  packets=%d'):format(os.date('%Y-%m-%d %H:%M:%S'), c.zone, #c.events)
                lines[#lines + 1] = ('NPC: name=%s id=%s index=%s menu=%s'):format(tostring(npcname), tostring(eid), tostring(eidx), tostring(c.npc.menu))
                lines[#lines + 1] = ('item(s) traded: %s'):format(#item_names > 0 and table.concat(item_names, ', ') or '(none detected)')
                if eid and eidx then
                    lines[#lines + 1] = 'STORE_FIXED_NPCS entry:'
                    lines[#lines + 1] = ("    ['%s'] = { zone = %d, id = %d, index = %d },"):format(tostring(npcname), c.zone, eid, eidx)
                end
                -- PII scrub: redact the capturing character's OWN server id + name from the hex/notes so
                -- the file is safe to hand to the dev. NPC ids/indices are kept -- the executor needs them.
                local me = windower.ffxi.get_player()
                local reds = {}
                if me and me.id and me.id > 0 then
                    local id = me.id
                    reds[#reds + 1] = { ('%02X %02X %02X %02X'):format(id % 256, math.floor(id / 256) % 256, math.floor(id / 65536) % 256, math.floor(id / 16777216) % 256), 'ID ID ID ID' }
                end
                if me and me.name and #me.name > 0 then
                    local nb, nm = {}, {}
                    for i = 1, #me.name do nb[i] = ('%02X'):format(me.name:byte(i)); nm[i] = 'NM' end
                    reds[#reds + 1] = { table.concat(nb, ' '), table.concat(nm, ' ') }
                end
                local function cap_scrub(s)
                    if type(s) ~= 'string' then return s end
                    for _, r in ipairs(reds) do s = s:gsub(r[1], r[2]) end
                    return s
                end
                for _, ev in ipairs(c.events) do
                    lines[#lines + 1] = ('[+%7.3f] %s 0x%03X len=%-3d %s'):format(ev.t, ev.dir == 'in' and 'IN ' or 'OUT', ev.id, ev.len, cap_scrub(ev.note))
                    lines[#lines + 1] = '            ' .. cap_scrub(ev.hex)
                end

                local base = windower.addon_path .. 'debug'
                if windower.dir_exists and not windower.dir_exists(base) then windower.create_dir(base) end
                if windower.dir_exists and not windower.dir_exists(base .. '/captures') then windower.create_dir(base .. '/captures') end
                local function san(s) return (tostring(s):gsub('[^%w]', '-')) end
                local fname = ('%s_%s_%s.txt'):format(san(npcname), san(primary), os.date('%Y%m%d_%H%M%S'))
                local f = io.open(base .. '/captures/' .. fname, 'w')
                if f then f:write(table.concat(lines, '\n') .. '\n'); f:close() end
                alex_chat(207, ('[Alexandria] capture saved: %s stores %s (%d packets) -> debug/captures/%s'):format(npcname, primary, #c.events, fname), 'action')
            end
        end
    elseif cmd == 'learn' then
        local sub = (a[2] or ''):lower()
        local batch = tonumber(sub)
        if sub == '' or sub == 'start' or (batch and batch > 0) then
            local tgt = windower.ffxi.get_mob_by_target('t')
            local b = (batch and batch > 1) and batch or nil
            if not (tgt and tgt.name and tgt.name ~= '') then
                alex_chat(207, '[Alexandria] Target the NPC first, then //ax learn', 'error')
            elseif capture then
                alex_chat(207, '[Alexandria] Already learning; trade, click through, then //ax learn done', 'action')
            else
                local zinfo = windower.ffxi.get_info()
                capture = { t0 = os.clock(), events = {}, npc = {}, items = {}, zone = (zinfo and zinfo.zone) or 0,
                    tname = tgt.name, tid = tgt.id, tindex = tgt.index, batch = b }
                alex_chat(207, ('[Alexandria] Learning %s%s: trade the item(s), click through, then //ax learn done'):format(tgt.name, b and (' (batches of ' .. b .. ')') or ''), 'action')
            end
        elseif sub == 'done' then
            if not capture then
                alex_chat(207, '[Alexandria] Nothing to learn; target the NPC and //ax learn first', 'error')
            else
                local c = capture; capture = nil
                local r = store_capture_commit(c)
                if not r.saved then
                    alex_chat(207, '[Alexandria] No completed trade caught; try //ax learn again', 'error')
                else
                    local _, path = store_share_write()
                    local what = (r.added and r.added > 0) and ('+%d item(s) incl. %s'):format(r.added, r.primary) or ('%s (already knew it)'):format(r.primary)
                    local tail = (r.added and r.added > 0 and path) and (' In %s to send the dev.'):format(path) or ''
                    alex_chat(207, ('[Alexandria] Learned %s: %s. Usable in-game now.%s'):format(r.npcname, what, tail), 'action')
                end
            end
        elseif sub == 'send' then
            local n, path = store_share_write()
            alex_chat(207, path and (('[Alexandria] %d NPC(s), send to dev: %s'):format(n, path)) or '[Alexandria] Nothing to share yet', path and 'action' or 'error')
        elseif sub == 'list' then
            local names = {}
            for name, e in pairs(store_discovered) do if type(e) == 'table' and not STORE_DEFAULTS[name] then names[#names + 1] = name end end
            table.sort(names)
            alex_chat(207, #names == 0 and '[Alexandria] No NPCs taught yet' or ('[Alexandria] Taught: ' .. table.concat(names, ', ')))
        elseif sub == 'cancel' then
            capture = nil
            alex_chat(207, '[Alexandria] learn cancelled')
        else
            alex_chat(207, '[Alexandria] //ax learn [batchSize] | done | send | list | cancel')
        end
    elseif cmd == 'perf' then
        local sub = (a[2] or ''):lower()
        if sub == 'on' then
            prof = {}; prof_frames = 0; prof_on = true
            alex_chat(207, '[Alexandria] perf ON; play normally ~30s, then //ax perf to see the report')
        elseif sub == 'off' then
            prof_on = false
            alex_chat(207, '[Alexandria] perf OFF')
        elseif sub == 'reset' then
            prof = {}; prof_frames = 0
            alex_chat(207, '[Alexandria] perf counters reset')
        else
            local list = {}
            for name, e in pairs(prof) do list[#list + 1] = { name = name, t = e.t, n = e.n, mx = e.mx } end
            table.sort(list, function(x, y) return x.mx > y.mx end)
            if #list == 0 then
                alex_chat(207, '[Alexandria] no samples; run //ax perf on first')
            else
                local pl = windower.ffxi.get_player()
                local lines = {}
                lines[#lines + 1] = ('Alexandria perf report  char=%s  zone=%s  frames=%d'):format(
                    tostring(pl and pl.name), tostring((windower.ffxi.get_info() or {}).zone), prof_frames)
                lines[#lines + 1] = 'section              max(ms)   avg(ms)  total(ms)   samples'
                for _, e in ipairs(list) do
                    lines[#lines + 1] = ('%-18s  %8.2f  %8.3f  %9.0f  %8d'):format(e.name, e.mx, e.t / math.max(1, e.n), e.t, e.n)
                end
                local path = windower.addon_path .. 'data/perf.txt'
                local f = io.open(path, 'w')
                if f then
                    f:write(table.concat(lines, '\n') .. '\n'); f:close()
                    alex_chat(207, '[Alexandria] wrote perf report to Alexandria/data/perf.txt')
                else
                    alex_chat(207, '[Alexandria] could not open data/perf.txt for writing')
                end
            end
        end
    elseif cmd == 'release' then
        cfarm = nil
        cbuy_release()
        emit_convert_off()
        curio_scan = nil
        npc_menu_close()
        alex_chat(207, '[Alexandria] released NPC menu')
    elseif cmd == 'sell' then
        local toks = {}
        for i = 2, #a do toks[#toks + 1] = a[i] end
        local qty = 1
        if #toks > 1 and tonumber(toks[#toks]) then qty = tonumber(table.remove(toks)) end
        local arg = table.concat(toks, ' ')
        local sid = tonumber(arg)
        if not sid and arg ~= '' then sid = build_name_index()[arg:lower()] end
        if not sid then
            alex_chat(207, '[Alexandria] sell: item not found: ' .. arg, 'error')
        elseif shop_sell_by_id(sid, math.max(1, qty)) then
            alex_chat(207, '[Alexandria] direct sell sent: ' .. (res.items[sid] and res.items[sid].en or sid) .. ' x' .. qty)
        else
            local inv = windower.ffxi.get_items(0)
            local found, st, cnt, bz = false, -1, 0, -1
            if inv then for s = 1, (inv.max or 80) do local it = inv[s]; if type(it) == 'table' and it.id == sid then found = true; st = it.status or -1; cnt = it.count or 0; bz = it.bazaar or -1; break end end end
            alex_chat(207, ('[Alexandria] sell fail id=%d found=%s status=%s count=%d bazaar=%s'):format(sid, tostring(found), tostring(st), cnt, tostring(bz)), 'error')
        end
    elseif cmd == 'sellall' then
        -- Fire the auto-sell list on demand. Gated on Experimental Features so it
        -- works even when "Auto-Sell In Towns" is toggled off, letting you trigger
        -- a shop sell from the command line.
        if not experimental_features then
            alex_chat(207, '[Alexandria] sellall requires Experimental Features (enable it in Settings).', 'error')
        elseif next(shop_sell_list) == nil then
            alex_chat(207, '[Alexandria] sellall: your Sell list is empty.', 'progress')
        elseif not (shop_session or in_town()) then
            alex_chat(207, '[Alexandria] sellall: open a shop or stand in a town first.', 'error')
        else
            local inv = windower.ffxi.get_items(0)
            local n = 0
            if inv then for s = 1, (inv.max or 80) do local it = inv[s]; if type(it) == 'table' and it.id and it.id ~= 0 and shop_sell_list[it.id] and it.status == 0 and not shop_no_sale(it.id) then n = n + 1 end end end
            if n == 0 then
                alex_chat(207, '[Alexandria] sellall: no auto-sell items in your inventory.', 'progress')
            else
                shop_sold = {}
                shop_autosell_run()
                alex_chat(207, '[Alexandria] sellall: selling ' .. n .. ' auto-sell item(s).', 'action')
            end
        end
    elseif cmd == 'autolot' then
        -- Toggle acting on the lot list. Per-character by default; add "all" to flip
        -- every character (the desktop relays and persists it across the fleet).
        local t1 = (a[2] or ''):lower()
        local scope_all = (t1 == 'all')
        local onoff = scope_all and (a[3] or ''):lower() or t1
        local target
        if onoff == 'on' then target = true
        elseif onoff == 'off' then target = false
        else target = not pool_autolot_on end
        pool_autolot_on = target
        queue_send('{"t":"autolot","on":' .. (target and 'true' or 'false') .. (scope_all and ',"all":true' or '') .. '}\n')
        alex_chat(207, '[Alexandria] auto-lot ' .. (target and 'ON' or 'OFF') .. (scope_all and ' for all characters.' or ' for this character.'), 'action')
    elseif cmd == 'rsdebug' then
        rs_debug = not rs_debug
        alex_chat(207, '[Alexandria] resupply debug ' .. (rs_debug and 'ON' or 'OFF'))
    elseif cmd == 'shopdebug' then
        local watching = {}
        for nm in pairs(npc_watch) do watching[#watching + 1] = nm end
        alex_chat(207, '[Alexandria] watching: ' .. (#watching > 0 and table.concat(watching, ', ') or '(none)'))
        local me = windower.ffxi.get_mob_by_target('me')
        local arr = windower.ffxi.get_mob_array()
        local found = 0
        if arr and me and me.x then
            for _, v in pairs(arr) do
                if v and v.name and npc_watch[v.name] and v.x then
                    found = found + 1
                    local dx, dy = v.x - me.x, v.y - me.y
                    alex_chat(207, ('[Alexandria] match: %s d=%.1f vt=%s'):format(v.name, math.sqrt(dx * dx + dy * dy), tostring(v.valid_target)))
                end
            end
        end
        if found == 0 then alex_chat(207, '[Alexandria] no watched NPC in range/array') end
        local nshop = 0
        for _ in pairs(shop.items) do nshop = nshop + 1 end
        alex_chat(207, ('[Alexandria] near=%s shop_items=%d'):format(npc_near and npc_near.name or 'nil', nshop))
    elseif cmd == 'bzmem' then
        alex_chat(207, '[Alexandria] mem dll loaded: ' .. tostring(memhelp_ok))
        if memhelp_ok and bz_mem_available() then
            alex_chat(207, ('[Alexandria] entity base: 0x%X'):format(bz_entity_base))
            local me = windower.ffxi.get_mob_by_target('me')
            if me then alex_chat(207, '[Alexandria] bazaars seen via memory: ' .. #bz_mem_collect(me, false)) end
        else
            alex_chat(207, '[Alexandria] memory detection unavailable, using packet fallback')
        end
    elseif cmd == 'dboxdump' then
        dbox_debug = not dbox_debug
        if dbox_debug then dbox_log('=== dbox dump ' .. os.date('%Y-%m-%d %H:%M:%S') .. ' ===', true) end
        alex_chat(207, '[Alexandria] dbox packet dump ' .. (dbox_debug and 'ON -> dboxdump.txt; open box + take an item manually' or 'OFF'), 'action')
    elseif cmd == 'tradedump' then
        trade_debug = not trade_debug
        if trade_debug then trade_log('=== trade dump ' .. os.date('%Y-%m-%d %H:%M:%S') .. ' ===', true) end
        alex_chat(207, '[Alexandria] trade packet dump ' .. (trade_debug and 'ON -> tradedump.txt; do one manual trade' or 'OFF'), 'action')
    elseif cmd == 'inbox' or cmd == 'ibox' or cmd == 'dbox' then
        alex_chat(207, dbox_open('in') and '[Alexandria] opening delivery inbox' or '[Alexandria] not at an auction house', 'action')
    elseif cmd == 'outbox' or cmd == 'obox' then
        alex_chat(207, dbox_open('out') and '[Alexandria] opening delivery outbox' or '[Alexandria] not at an auction house', 'action')
    else
        ax_forward(a)
    end
end)

windower.register_event('unhandled command', function(command, ...)
    local verb = (command or ''):lower()
    local spec = COMPAT[verb]
    if not spec or not settings.compat[spec.group] then return end
    if spec.mode == 'dbox' then
        alex_chat(207, dbox_open(spec.dir) and ('[Alexandria] opening delivery ' .. (spec.dir == 'out' and 'outbox' or 'inbox')) or '[Alexandria] not at an auction house', 'action')
        return
    end
    local args = { spec.as or verb }
    for _, v in ipairs({...}) do args[#args + 1] = v end
    ax_forward(args)
end)

windower.register_event('unload', function()
    disconnect()
end)
