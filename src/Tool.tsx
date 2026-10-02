// Deepend: finds the hours everyone on a team is free and proposes protected focus blocks, so deep work is not chopped up.
import { useMemo, useState } from "react";
import { downloadIcs } from "./lib/ics";
import { uid, useStored } from "./lib/store";
import { hhmm, toHours } from "./lib/time";
import { Section, Stat, Stats } from "./ui/kit";

const T = "deepend";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
type Member = { id: string; name: string; start: string; end: string; busy: string };
type Block = { day: number; a: number; b: number };
const SAMPLE: Member[] = [
  { id: "m1", name: "Amira", start: "09:00", end: "17:30", busy: "Mon 09:30-10:00 standup\nTue 09:30-10:00 standup\nWed 09:30-10:00 standup\nThu 09:30-10:00 standup\nFri 09:30-10:00 standup\nTue 14:00-15:00 design review\nThu 11:00-12:00 client call" },
  { id: "m2", name: "Walid", start: "08:30", end: "17:00", busy: "Mon 09:30-10:00 standup\nTue 09:30-10:00 standup\nWed 09:30-10:00 standup\nThu 09:30-10:00 standup\nFri 09:30-10:00 standup\nWed 13:00-14:30 architecture\nFri 15:00-16:00 retro" },
  { id: "m3", name: "Ines", start: "09:00", end: "18:00", busy: "Mon 09:30-10:00 standup\nTue 09:30-10:00 standup\nWed 09:30-10:00 standup\nThu 09:30-10:00 standup\nFri 09:30-10:00 standup\nMon 15:00-16:00 1:1\nThu 14:00-15:30 hiring panel" },
];

function parseBusy(text: string): Block[] {
  return text.split("\n").map(l => l.match(/^(mon|tue|wed|thu|fri)\w*\s+(\d{1,2}[:.]\d{2})\s*[-–]\s*(\d{1,2}[:.]\d{2})/i)).filter(Boolean)
    .map(m => ({ day: DAYS.findIndex(d => d.toLowerCase() === m![1].slice(0, 3).toLowerCase()), a: toHours(m![2].replace(".", ":")), b: toHours(m![3].replace(".", ":")) }));
}
/** Free intervals shared by everyone on one day, in half-hour steps. */
function sharedFree(members: Member[], day: number, lunch: boolean) {
  const lo = Math.max(...members.map(m => toHours(m.start))), hi = Math.min(...members.map(m => toHours(m.end)));
  const busy = members.flatMap(m => parseBusy(m.busy)).filter(b => b.day === day);
  const out: [number, number][] = []; let cur: number | null = null;
  for (let t = lo; t < hi; t += 0.5) {
    const free = !busy.some(b => t < b.b && t + 0.5 > b.a) && !(t >= 12.5 && t < 13.5 && lunch);
    if (free && cur === null) cur = t;
    if (!free && cur !== null) { out.push([cur, t]); cur = null; }
  }
  if (cur !== null) out.push([cur, hi]);
  return out;
}

export default function Deepend() {
  const [members, setMembers] = useStored<Member[]>(T, "members", SAMPLE);
  const [minLen, setMinLen] = useStored(T, "min", 2);
  const [lunch, setLunch] = useStored(T, "lunch", true);
  const [perWeek, setPerWeek] = useStored(T, "perWeek", 4);
  const [edit, setEdit] = useState<string | null>(null);

  const { free, picks } = useMemo(() => {
    const free = DAYS.map((_, d) => sharedFree(members, d, lunch));
    const cands = free.flatMap((f, day) => f.filter(([a, b]) => b - a >= minLen).map(([a, b]) => ({ day, a, b: Math.min(b, a + 3), len: b - a })));
    // Prefer longer blocks, one per day, earlier in the day when tied.
    const picks: typeof cands = [];
    [...cands].sort((x, y) => y.len - x.len || x.a - y.a).forEach(c => { if (picks.length < perWeek && !picks.some(p => p.day === c.day)) picks.push(c); });
    return { free, picks: picks.sort((x, y) => x.day - y.day) };
  }, [members, minLen, lunch, perWeek]);
  const totalFocus = picks.reduce((a, p) => a + (p.b - p.a), 0);
  const lo = Math.min(...members.map(m => toHours(m.start)), 9), hi = Math.max(...members.map(m => toHours(m.end)), 17);
  const pct = (h: number) => ((h - lo) / (hi - lo)) * 100;

  const exportIcs = () => {
    const mon = new Date(); mon.setDate(mon.getDate() + ((8 - mon.getDay()) % 7 || 7)); mon.setHours(0, 0, 0, 0);
    const events = [0, 1, 2, 3].flatMap(w => picks.map(p => { const s = new Date(mon); s.setDate(s.getDate() + p.day + w * 7); s.setHours(Math.floor(p.a), (p.a % 1) * 60); const e = new Date(s.getTime() + (p.b - p.a) * 3600000); return { title: "Focus time (team, no meetings)", start: s, end: e }; }));
    downloadIcs("team-focus-blocks.ics", events, "Team focus time");
  };

  return (
    <div className="stack">
      <Section title="Protected focus time" aside={<button className="btn primary small" onClick={exportIcs} disabled={!picks.length}>Add 4 weeks to calendars</button>}>
        <Stats><Stat value={`${totalFocus} h`} label="Shared focus per week" tone={totalFocus >= 6 ? "good" : "warn"} /><Stat value={picks.length} label="Blocks" /><Stat value={members.length} label="People" /></Stats>
        <div className="row" style={{ marginTop: 14 }}>
          <label className="field" style={{ flex: "0 0 160px" }}><span>Shortest useful block</span><select id="de-min" className="input" value={minLen} onChange={e => setMinLen(+e.target.value)}>{[1, 1.5, 2, 2.5, 3].map(n => <option key={n} value={n}>{n} hours</option>)}</select></label>
          <label className="field" style={{ flex: "0 0 140px" }}><span>Blocks per week</span><select id="de-per" className="input" value={perWeek} onChange={e => setPerWeek(+e.target.value)}>{[2, 3, 4, 5].map(n => <option key={n}>{n}</option>)}</select></label>
          <label className="check" style={{ alignSelf: "flex-end", paddingBottom: 10 }}><input type="checkbox" checked={lunch} onChange={e => setLunch(e.target.checked)} />Keep 12:30 to 13:30 for lunch</label>
        </div>
        <div className="de-week">
          {DAYS.map((d, day) => (
            <div key={d} className="de-day">
              <span className="de-label">{d}</span>
              <div className="de-track">
                {members.flatMap(m => parseBusy(m.busy)).filter(b => b.day === day).map((b, i) => <i key={i} className="de-busy" style={{ left: `${pct(b.a)}%`, width: `${pct(b.b) - pct(b.a)}%` }} />)}
                {free[day].map(([a, b], i) => <i key={"f" + i} className="de-free" style={{ left: `${pct(a)}%`, width: `${pct(b) - pct(a)}%` }} />)}
                {picks.filter(p => p.day === day).map((p, i) => <b key={"p" + i} className="de-pick" style={{ left: `${pct(p.a)}%`, width: `${pct(p.b) - pct(p.a)}%` }}>{hhmm(p.a)} to {hhmm(p.b)}</b>)}
              </div>
            </div>
          ))}
          <div className="de-day"><span /><div className="de-ticks">{Array.from({ length: Math.floor(hi - lo) + 1 }, (_, i) => <span key={i} style={{ left: `${pct(lo + i)}%` }}>{hhmm(lo + i)}</span>)}</div></div>
        </div>
        <p className="note" style={{ marginTop: 8 }}>Grey: someone has a meeting. Light: everyone is free. Dark: proposed focus block.</p>
      </Section>

      <Section title="Team calendars" aside={<button className="btn small" onClick={() => setMembers([...members, { id: uid(), name: `Person ${members.length + 1}`, start: "09:00", end: "17:00", busy: "" }])}>Add a person</button>}>
        <div className="stack" style={{ gap: 12 }}>
          {members.map(m => (
            <div key={m.id} className="de-m">
              <div className="row" style={{ alignItems: "flex-end" }}>
                <label className="field"><span>Name</span><input className="input" value={m.name} onChange={e => setMembers(members.map(x => x.id === m.id ? { ...x, name: e.target.value } : x))} /></label>
                <label className="field"><span>Starts</span><input type="time" className="input" value={m.start} onChange={e => setMembers(members.map(x => x.id === m.id ? { ...x, start: e.target.value } : x))} /></label>
                <label className="field"><span>Ends</span><input type="time" className="input" value={m.end} onChange={e => setMembers(members.map(x => x.id === m.id ? { ...x, end: e.target.value } : x))} /></label>
                <button className="btn small" onClick={() => setEdit(edit === m.id ? null : m.id)}>{edit === m.id ? "Done" : `Meetings (${parseBusy(m.busy).length})`}</button>
                <button className="btn ghost small danger" onClick={() => setMembers(members.filter(x => x.id !== m.id))}>Remove</button>
              </div>
              {edit === m.id && <label className="field" style={{ marginTop: 8 }}><span>One meeting per line, like: Tue 14:00-15:00 design review</span><textarea className="input" rows={6} value={m.busy} onChange={e => setMembers(members.map(x => x.id === m.id ? { ...x, busy: e.target.value } : x))} style={{ fontFamily: "var(--mono)", fontSize: 13 }} /></label>}
            </div>
          ))}
        </div>
      </Section>
      <style>{`.de-week{display:grid;gap:6px;margin-top:18px}.de-day{display:grid;grid-template-columns:40px 1fr;gap:10px;align-items:center}.de-label{font-family:var(--mono);font-size:12px;color:var(--muted)}
      .de-track{position:relative;height:34px;background:var(--sunk);border-radius:6px;overflow:hidden}.de-track i,.de-track b{position:absolute;top:0;bottom:0}.de-busy{background:color-mix(in srgb,var(--muted) 35%,transparent)}.de-free{background:color-mix(in srgb,var(--good) 18%,transparent)}
      .de-pick{top:4px!important;bottom:4px!important;background:var(--accent);color:var(--accent-ink);border-radius:5px;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;white-space:nowrap;overflow:hidden}
      .de-ticks{position:relative;height:16px}.de-ticks span{position:absolute;transform:translateX(-50%);font-family:var(--mono);font-size:10px;color:var(--muted)}.de-m{padding-bottom:12px;border-bottom:1px solid var(--line)}`}</style>
    </div>
  );
}
