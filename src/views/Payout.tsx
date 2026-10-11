import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CircleCheck, Divide, HandCoins, ShieldCheck, TriangleAlert, UserPlus, X } from "lucide-react";
import { Button } from "@/components/arc/button/button";
import { Alert, Thumb } from "@/components/ui";
import { api, errorText, type PayeeInfo } from "@/lib/api";
import { useData } from "@/lib/data";
import { count, robux } from "@/lib/format";
import { useSettings } from "@/lib/settings";
import { createStore } from "@/lib/store";
import { useCached } from "@/lib/useLoad";
import "./Payout.css";

/** Usernames recently paid from each group, for one-click re-adding. */
const useRecent = createStore<{ byGroup: Record<string, string[]> }>("groupwise.payees", { byGroup: {} });

type Row = PayeeInfo & { amount: string };
type Step = "build" | "review" | "code" | "done";

export function Payout({ groupId, onClose }: { groupId: string | null; onClose: () => void }) {
  return (
    <Dialog.Root open={!!groupId} onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="modal payout" aria-describedby={undefined} onInteractOutside={e => e.preventDefault()}>
          {groupId && <PayoutFlow key={groupId} groupId={groupId} onClose={onClose} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PayoutFlow({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const [settings] = useSettings();
  const { groupById, funds, cash } = useData();
  const [recent, setRecent] = useRecent();
  const group = groupById.get(groupId);
  const finance = useCached(force => api.groupFinance(groupId, settings.timeframe, force), [groupId, settings.timeframe, "payout"]);
  const balance = funds.data?.[groupId]?.finance?.balance ?? finance.data?.balance ?? null;

  const [step, setStep] = useState<Step>("build");
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState("");
  const [split, setSplit] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [media, setMedia] = useState("authenticator");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amounts = rows.map(r => Math.floor(Number(r.amount)));
  const total = amounts.reduce((s, a) => s + (Number.isFinite(a) && a > 0 ? a : 0), 0);
  const after = balance != null ? balance - total : null;
  const problems = [
    !rows.length && "Add at least one person.",
    amounts.some(a => !Number.isFinite(a) || a < 1) && "Every amount must be a whole number of Robux, at least 1.",
    rows.some(r => !r.roleName) && "Everyone must be a member of the group.",
    after != null && after < 0 && "That's more than the group has.",
  ].filter((p): p is string => !!p);

  const add = async (input: string) => {
    const list = input.split(/[\s,;]+/).map(s => s.replace(/^@/, "")).filter(Boolean);
    const fresh = list.filter(n => !rows.some(r => r.name.toLowerCase() === n.toLowerCase()));
    if (!fresh.length) return;
    setBusy(true);
    setError(null);
    try {
      const found = await api.findPayees(groupId, fresh);
      const missing = fresh.filter(n => !found.some(f => f.name.toLowerCase() === n.toLowerCase()));
      setRows(rs => [...rs, ...found.filter(f => !rs.some(r => r.id === f.id)).map(f => ({ ...f, amount: "" }))]);
      setNames("");
      if (missing.length) setError(`No Roblox user called ${missing.join(", ")}.`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const splitEvenly = () => {
    const t = Math.floor(Number(split));
    if (!rows.length || !Number.isFinite(t) || t < rows.length) return;
    const each = Math.floor(t / rows.length);
    const extra = t - each * rows.length;
    setRows(rs => rs.map((r, i) => ({ ...r, amount: String(each + (i < extra ? 1 : 0)) })));
  };

  const finish = () => {
    setRecent(s => ({ byGroup: { ...s.byGroup, [groupId]: [...new Set([...rows.map(r => r.name), ...(s.byGroup[groupId] ?? [])])].slice(0, 12) } }));
    funds.reload();
    finance.reload();
    setStep("done");
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.groupPayout(groupId, rows.map((row, i) => ({ userId: row.id, amount: amounts[i] })));
      if (r.status === "paid") finish();
      else {
        setMedia(r.mediaType);
        setStep("code");
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.groupPayoutVerify(code);
      if (r.status === "paid") finish();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (step === "code") api.cancelPayout();
    onClose();
  };

  const recentNames = (recent.byGroup[groupId] ?? []).filter(n => !rows.some(r => r.name.toLowerCase() === n.toLowerCase()));

  return (
    <>
      <div className="payout-head">
        <Thumb src={group?.iconUrl} name={group?.name ?? "Group"} size={40} />
        <div className="detail-title">
          <Dialog.Title asChild>
            <h3>Pay out from {group?.name ?? `group ${groupId}`}</h3>
          </Dialog.Title>
          <span className="muted small">{balance != null ? `${robux(balance)} available · ${cash(balance)}` : finance.error ?? "Loading funds…"}</span>
        </div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={close}>
          <X size={16} />
        </button>
      </div>

      {error && <Alert>{error}</Alert>}

      {step === "build" && (
        <>
          <form className="row payout-add" onSubmit={e => { e.preventDefault(); add(names); }}>
            <input value={names} onChange={e => setNames(e.target.value)} placeholder="Usernames, separated by spaces or commas" aria-label="Usernames to add" autoFocus />
            <Button size="sm" type="submit" loading={busy} disabled={!names.trim()}>
              <UserPlus size={14} /> Add
            </Button>
          </form>
          {recentNames.length > 0 && (
            <div className="chips">
              <span className="muted small">Recent:</span>
              {recentNames.map(n => (
                <button type="button" key={n} className="chip" onClick={() => add(n)}>@{n}</button>
              ))}
            </div>
          )}

          <div className="payees">
            {rows.length ? (
              rows.map((r, i) => (
                <div key={r.id} className="payee">
                  <Thumb src={r.headshotUrl} name={r.name} size={34} />
                  <span className="row-main">
                    <span className="truncate">{r.displayName}</span>
                    <span className={`small truncate ${r.roleName ? "muted" : "warn"}`}>
                      @{r.name} · {r.roleName ?? "not in this group"}
                    </span>
                  </span>
                  <label className="amount">
                    <span>R$</span>
                    <input inputMode="numeric" value={r.amount} placeholder="0" aria-label={`Amount for ${r.name}`} onChange={e => setRows(rs => rs.map((x, j) => (j === i ? { ...x, amount: e.target.value.replace(/\D/g, "") } : x)))} />
                  </label>
                  <button type="button" className="icon-btn" aria-label={`Remove ${r.name}`} onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}>
                    <X size={14} />
                  </button>
                </div>
              ))
            ) : (
              <p className="muted small payees-empty">Add the people to pay. They must be members of the group.</p>
            )}
          </div>

          {rows.length > 1 && (
            <form className="row split" onSubmit={e => { e.preventDefault(); splitEvenly(); }}>
              <span className="muted small">Split</span>
              <label className="amount">
                <span>R$</span>
                <input inputMode="numeric" value={split} placeholder="Total" aria-label="Total to split evenly" onChange={e => setSplit(e.target.value.replace(/\D/g, ""))} />
              </label>
              <span className="muted small">evenly between {rows.length}</span>
              <Button size="sm" variant="ghost" type="submit" disabled={!split}>
                <Divide size={14} /> Split
              </Button>
            </form>
          )}

          <Summary total={total} after={after} people={rows.length} cash={cash} />
          {rows.length > 0 && problems.length > 0 && <p className="small warn">{problems[0]}</p>}
          <div className="payout-actions">
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button onClick={() => { setError(null); setConfirm(""); setStep("review"); }} disabled={problems.length > 0}>
              Review payout
            </Button>
          </div>
        </>
      )}

      {step === "review" && (
        <>
          <div className="review-list">
            {rows.map((r, i) => (
              <div key={r.id} className="review-row">
                <Thumb src={r.headshotUrl} name={r.name} size={26} />
                <span className="truncate">{r.displayName} <span className="muted small">@{r.name}</span></span>
                <strong>{robux(amounts[i])}</strong>
              </div>
            ))}
          </div>
          <Summary total={total} after={after} people={rows.length} cash={cash} />
          <div className="notice-warn">
            <TriangleAlert size={15} />
            <span>Payouts can't be undone. Robux goes to each person's pending balance straight away.</span>
          </div>
          <label className="field">
            <span>Type <b>PAY</b> to confirm</span>
            <input value={confirm} onChange={e => setConfirm(e.target.value)} autoFocus aria-label="Type PAY to confirm" />
          </label>
          <div className="payout-actions">
            <Button variant="ghost" onClick={() => setStep("build")} disabled={busy}>Back</Button>
            <Button variant="danger" onClick={send} loading={busy} disabled={confirm.trim().toUpperCase() !== "PAY"}>
              <HandCoins size={14} /> Pay {robux(total)}
            </Button>
          </div>
        </>
      )}

      {step === "code" && (
        <form className="stack-sm" onSubmit={e => { e.preventDefault(); verify(); }}>
          <div className="code-hero">
            <ShieldCheck size={22} />
            <p>
              Roblox wants your 2-step verification code.{" "}
              {media === "email" ? "Enter the code Roblox just emailed you." : "Enter the 6-digit code from your authenticator app."}
            </p>
          </div>
          <input className="code-input" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" aria-label="Verification code" autoFocus />
          <div className="payout-actions">
            <Button variant="ghost" type="button" onClick={close} disabled={busy}>Cancel</Button>
            <Button type="submit" variant="danger" loading={busy} disabled={code.length !== 6}>Verify and pay</Button>
          </div>
        </form>
      )}

      {step === "done" && (
        <div className="done">
          <CircleCheck size={36} />
          <h3>Paid {robux(total)}</h3>
          <p className="muted">
            Sent to {count(rows.length)} {rows.length === 1 ? "person" : "people"} from {group?.name ?? "the group"}. It shows in their pending Robux.
          </p>
          <Button onClick={onClose}>Done</Button>
        </div>
      )}
    </>
  );
}

function Summary({ total, after, people, cash }: { total: number; after: number | null; people: number; cash: (r: number) => string }) {
  return (
    <div className="payout-summary">
      <div>
        <span className="muted small">Total to {people} {people === 1 ? "person" : "people"}</span>
        <strong>{robux(total)}</strong>
        <span className="muted small">{cash(total)}</span>
      </div>
      <div>
        <span className="muted small">Group funds after</span>
        <strong className={after != null && after < 0 ? "warn" : ""}>{after != null ? robux(after) : "—"}</strong>
      </div>
    </div>
  );
}
