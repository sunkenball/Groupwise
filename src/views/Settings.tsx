import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { LogIn } from "lucide-react";
import { Button } from "@/components/arc/button/button";
import { Badge } from "@/components/arc/badge/badge";
import { SortableDataTable, type DataColumn } from "@/components/arc/sortable-data-table/sortable-data-table";
import { api, errorText, type Rates, type SecretName } from "@/lib/api";
import { useData } from "@/lib/data";
import { money } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { DEFAULT_DEVEX_RATE, useSettings } from "@/lib/settings";
import { Thumb } from "@/components/ui";

type Message = { tone: "ok" | "error"; text: string };

export function SettingsView() {
  const [settings, update] = useSettings();
  const { status, rates, me } = useData();
  const [userId, setUserId] = useState(settings.userId);
  const [message, setMessage] = useState<Message | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const onSecretsChanged = status.reload;

  const fromCookie = async () => {
    try {
      const u = await api.cookieUser();
      setUserId(String(u.id));
      update({ userId: String(u.id) });
      setMessage({ tone: "ok", text: `Logged in as ${u.displayName} (@${u.name}). User ID set to ${u.id}.` });
    } catch (e) {
      setMessage({ tone: "error", text: errorText(e) });
    }
  };

  const loginWithRoblox = async () => {
    setLoggingIn(true);
    setMessage({ tone: "ok", text: "Log in to Roblox in the window that just opened…" });
    try {
      const result = await api.loginWithRoblox();
      if (result.status === "captured") {
        setUserId(String(result.user.id));
        update({ userId: String(result.user.id) });
        onSecretsChanged();
        setMessage({ tone: "ok", text: `Logged in as ${result.user.displayName} (@${result.user.name}).` });
      } else if (result.status === "cancelled") {
        setMessage({ tone: "error", text: "The login window was closed before you logged in." });
      } else {
        setMessage({ tone: "error", text: "Login timed out. Try again." });
      }
    } catch (e) {
      setMessage({ tone: "error", text: errorText(e) });
    } finally {
      setLoggingIn(false);
    }
  };

  const hasCookie = !!status.data?.hasCookie;

  return (
    <div className="stack settings">
      {message && <div className={message.tone === "ok" ? "notice" : "alert"}>{message.text}</div>}

      <section className="panel">
        <div className="panel-head">
          <h3>Roblox account</h3>
          <Badge tone={hasCookie ? "success" : "neutral"} size="sm">{hasCookie ? "Logged in" : "Not logged in"}</Badge>
        </div>
        <div className="row">
          <Button variant="primary" loading={loggingIn} onClick={loginWithRoblox}>
            <LogIn size={15} /> {hasCookie ? "Log in again" : "Log in with Roblox"}
          </Button>
          {hasCookie && (
            <Button variant="danger" size="sm" onClick={() => api.clearSecret("cookie").then(() => { onSecretsChanged(); setMessage({ tone: "ok", text: "Logged out." }); })}>
              Log out
            </Button>
          )}
        </div>
        <p className="muted small">
          Robux, group funds and sales are only available to a logged-in account. Your login cookie is kept in Windows Credential Manager and only sent to roblox.com.
        </p>
        <label className="field">
          <span>Your Roblox user ID</span>
          <div className="row">
            <input value={userId} inputMode="numeric" placeholder="e.g. 123456789" onChange={e => setUserId(e.target.value.replace(/\D/g, ""))} />
            <Button size="sm" onClick={() => update({ userId })} disabled={userId === settings.userId}>Save</Button>
            {hasCookie && <Button size="sm" variant="secondary" onClick={fromCookie}>Use logged-in account</Button>}
          </div>
          <small className="muted">Set automatically when you log in. It's the number in roblox.com/users/<b>123456789</b>/profile</small>
        </label>
      </section>

      <section className="panel">
        <h3>Groups</h3>
        <label className="field">
          <span>Ignore groups where my rank is at or below</span>
          <div className="row">
            <input type="number" min={0} max={254} value={settings.ignoreRankAtOrBelow} onChange={e => update({ ignoreRankAtOrBelow: Math.max(0, Math.min(254, Number(e.target.value) || 0)) })} />
          </div>
          <small className="muted">Rank 1 is usually the plain "Member" role. Set to 0 to show every group. Pinned groups are always shown.</small>
        </label>
      </section>

      <section className="panel">
        <h3>Conversion</h3>
        <div className="grid-2">
          <label className="field">
            <span>DevEx rate (USD per Robux)</span>
            <div className="row">
              <input type="number" step="0.0001" min="0" value={settings.devexRate} onChange={e => update({ devexRate: Number(e.target.value) || 0 })} />
              {settings.devexRate !== DEFAULT_DEVEX_RATE && <Button size="sm" variant="ghost" onClick={() => update({ devexRate: DEFAULT_DEVEX_RATE })}>Reset</Button>}
            </div>
          </label>
          <label className="field">
            <span>Display currency</span>
            <select value={settings.currency} onChange={e => update({ currency: e.target.value })}>
              {Object.keys(rates.data?.rates ?? { [settings.currency]: 1 }).map(code => <option key={code}>{code}</option>)}
            </select>
          </label>
        </div>
        <RatesTable rates={rates.data} devexRate={settings.devexRate} balance={me.data?.balance ?? null} selected={settings.currency} />
      </section>

      <HiddenItems />

      <section className="panel">
        <h3>Cache</h3>
        <p className="muted small">
          Roblox data is cached so the app doesn't hit rate limits: groups for 30 minutes, funds for 3 minutes, sales for 10 minutes, game lists for an hour. Refresh in the top bar fetches fresh data. Clearing the cache makes the next load fetch everything again.
        </p>
        <div className="row">
          <Button size="sm" variant="secondary" onClick={() => api.clearCache().then(() => setMessage({ tone: "ok", text: "Cache cleared." }))}>Clear cache</Button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Open Cloud API key (for game analytics)</h3>
          <Badge tone={status.data?.hasApiKey ? "success" : "neutral"} size="sm">{status.data?.hasApiKey ? "Saved" : "Not set"}</Badge>
        </div>
        <p className="muted small">
          Analytics (players, playtime, retention, revenue, performance) come from Roblox's Open Cloud Analytics API. Create a key at{" "}
          <a href="#" onClick={e => { e.preventDefault(); openUrl("https://create.roblox.com/dashboard/credentials"); }}>Creator Hub → Credentials</a>: add the <b>universe-analytics</b> API system with <b>universe.analytics:read</b> and select each experience you want to see. Adding <b>groups</b> with <b>group:read</b> also gives a fallback for loading groups. Keys unused for 60 days expire.
        </p>
        <SecretInput name="apiKey" saved={!!status.data?.hasApiKey} onChanged={onSecretsChanged} setMessage={setMessage} />
      </section>

      <details className="panel advanced">
        <summary>
          <h3>Paste a login cookie manually</h3>
        </summary>
        <p className="muted small">Only if "Log in with Roblox" doesn't work. Paste the .ROBLOSECURITY cookie value:</p>
        <SecretInput name="cookie" saved={hasCookie} onChanged={onSecretsChanged} setMessage={setMessage} />
      </details>
    </div>
  );
}

function SecretInput({ name, saved, onChanged, setMessage }: { name: SecretName; saved: boolean; onChanged: () => void; setMessage: (m: Message) => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const label = name === "apiKey" ? "API key" : "Cookie";

  const run = async (action: () => Promise<void>, ok: string) => {
    setBusy(true);
    try {
      await action();
      setValue("");
      setMessage({ tone: "ok", text: ok });
      onChanged();
    } catch (e) {
      setMessage({ tone: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="row">
      <input type="password" autoComplete="off" spellCheck={false} value={value} placeholder={saved ? `${label} saved. Paste a new one to replace it` : `Paste ${label.toLowerCase()}`} onChange={e => setValue(e.target.value)} />
      <Button size="sm" variant="secondary" loading={busy} disabled={!value.trim()} onClick={() => run(() => api.saveSecret(name, value), `${label} saved.`)}>Save</Button>
      {saved && <Button size="sm" variant="danger" onClick={() => run(() => api.clearSecret(name), `${label} removed.`)}>Remove</Button>}
    </div>
  );
}

const MAJOR = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "INR", "BRL", "MXN", "PHP", "PLN", "SEK", "TRY", "IDR", "KRW"];
type RateRow = { code: string; perUsd: number; per1k: number; balance: number | null };

function RatesTable({ rates, devexRate, balance, selected }: { rates: Rates | null; devexRate: number; balance: number | null; selected: string }) {
  if (!rates) return <p className="muted small">Loading rates…</p>;
  const codes = MAJOR.includes(selected) ? MAJOR : [selected, ...MAJOR];
  const rows: RateRow[] = codes
    .filter(code => rates.rates[code])
    .map(code => ({ code, perUsd: rates.rates[code], per1k: 1000 * devexRate * rates.rates[code], balance: balance === null ? null : balance * devexRate * rates.rates[code] }));
  const columns: DataColumn<RateRow>[] = [
    { key: "code", label: "Currency", sortable: true, render: v => <strong>{String(v)}</strong> },
    { key: "perUsd", label: "Per 1 USD", sortable: true, numeric: true, render: v => (v as number).toLocaleString("en-US", { maximumFractionDigits: 4 }) },
    { key: "per1k", label: "R$ 1,000 at DevEx", sortable: true, numeric: true, render: (v, row) => money(v as number, row.code) },
    ...(balance === null ? [] : [{ key: "balance", label: "Your Robux", sortable: true, numeric: true, render: (v: unknown, row: RateRow) => money(v as number, row.code) }]),
  ];
  return <SortableDataTable rows={rows} columns={columns} rowKey="code" caption={`FX updated ${new Date(rates.updated).toLocaleDateString()}`} itemName={{ one: "currency", other: "currencies" }} />;
}

/** Everything hidden from lists and totals, with a way to bring it back. */
function HiddenItems() {
  const { prefs, toggleHidden, update } = usePrefs();
  const { groupById, gameById } = useData();
  const items = prefs.hidden.map(id => {
    const [kind, key] = id.split(":");
    const g = kind === "group" ? groupById.get(key) : gameById.get(Number(key));
    return { id, kind, name: g?.name ?? `${kind === "group" ? "Group" : "Game"} ${key}`, icon: g?.iconUrl ?? null };
  });
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Hidden items</h3>
        {items.length > 1 && <Button size="sm" variant="ghost" onClick={() => update({ hidden: [] })}>Show all</Button>}
      </div>
      {items.length ? (
        <ul className="rows">
          {items.map(i => (
            <li key={i.id} className="row">
              <Thumb src={i.icon} name={i.name} size={28} />
              <span className="row-main">
                <span className="truncate">{i.name}</span>
                <span className="muted small">{i.kind === "group" ? "Group" : "Game"}</span>
              </span>
              <Button size="sm" variant="secondary" onClick={() => toggleHidden(i.id)}>Show</Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Nothing hidden. Right-click a group or game and choose Hide to keep it out of lists and totals.</p>
      )}
    </section>
  );
}
