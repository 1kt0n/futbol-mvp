import { useState } from 'react'
import { useI18n } from '../i18n/I18nProvider.jsx'
import { DEMO_PREFIX, IS_DEMO } from '../lib/mode.js'
import { matchLabel } from '../lib/model.js'

/*
 * Mesa de control → VEEDORES. Los veedores tienen nombre y ROTAN entre canchas: en la cancha tocan
 * el partido y lo toman (desde ahí son los únicos que lo cargan). Acá se dan de alta, se les pasa
 * el link (se ve UNA sola vez: en la base queda solo el hash), se renueva o se da de baja.
 * Quién tiene cada partido se cambia desde el partido (Partidos → Veedor).
 */

const LIVE = new Set(['LIVE', 'HALFTIME'])
const DONE = new Set(['FINISHED', 'WALKOVER'])

const linkFor = (token) => `${window.location.origin}${IS_DEMO ? DEMO_PREFIX : ''}/v/${token}`

export default function StaffTab({ staff, model, act, busy }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [shown, setShown] = useState(null) // {name, link}: el link recién generado
  const [arm, setArm] = useState(null) // `${id}:rotate` | `${id}:revoke`
  const veedores = staff.filter((s) => s.role === 'VEEDOR')
  const active = veedores.filter((s) => !s.revoked)
  const revoked = veedores.filter((s) => s.revoked)

  // Partidos que tiene cada uno y todavía no terminaron (en juego primero).
  const holding = new Map()
  for (const m of model.matches) {
    if (!m.veedor_staff_id || DONE.has(m.status) || m.confirmed) continue
    if (!holding.has(m.veedor_staff_id)) holding.set(m.veedor_staff_id, [])
    holding.get(m.veedor_staff_id).push(m)
  }
  for (const list of holding.values()) list.sort((a, b) => Number(LIVE.has(b.status)) - Number(LIVE.has(a.status)))

  const add = async (e) => {
    e.preventDefault()
    const n = name.trim()
    if (n.length < 2) return
    const out = await act('POST', '/staff', { full_name: n }, `Veedor agregado: ${n}.`)
    if (out?.token) {
      setShown({ name: n, link: linkFor(out.token) })
      setName('')
    }
  }
  const armed = (key, fn) => () => {
    if (arm !== key) return setArm(key)
    setArm(null)
    fn()
  }
  const rotate = async (s) => {
    const out = await act('POST', `/staff/${s.id}/rotate-token`, null, `Link nuevo para ${s.full_name}: el anterior ya no funciona.`)
    if (out?.token) setShown({ name: s.full_name, link: linkFor(out.token) })
  }
  const revoke = (s) => act('POST', `/staff/${s.id}/revoke`, null, `${s.full_name} dado de baja: su link ya no funciona.`)

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <section>
        <h2 className="kicker mb-2">Veedores activos ({active.length})</h2>
        {!active.length && <p className="card p-4 text-sm text-white/60">Todavía no hay veedores. Agregalos con su nombre →</p>}
        <ul className="space-y-2">
          {active.map((s) => {
            const mine = holding.get(s.id) || []
            return (
              <li key={s.id} className="card flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1 basis-full sm:basis-0">
                  <div className="truncate font-extrabold">{s.full_name}</div>
                  <div className="mt-0.5 text-xs text-white/55">
                    {mine.length ? (
                      mine.slice(0, 3).map((m, i) => (
                        <span key={m.code}>
                          {i > 0 && ' · '}
                          <span className={LIVE.has(m.status) ? 'font-bold text-[#ff8aa5]' : ''}>
                            {LIVE.has(m.status) ? '● ' : ''}Cancha {m.venue} {m.local?.time} ({matchLabel(m.code, t)})
                          </span>
                        </span>
                      ))
                    ) : (
                      <span>Sin partido tomado</span>
                    )}
                    {mine.length > 3 && ` · +${mine.length - 3}`}
                  </div>
                </div>
                <button type="button" disabled={busy} onClick={armed(`${s.id}:rotate`, () => rotate(s))} className={`focus-ring rounded-lg px-3 py-1.5 text-xs font-extrabold ring-1 ${arm === `${s.id}:rotate` ? 'bg-gold text-night ring-gold' : 'ring-white/20'}`}>
                  {arm === `${s.id}:rotate` ? 'Tocá de nuevo: el link actual deja de andar' : 'Link nuevo'}
                </button>
                <button type="button" disabled={busy} onClick={armed(`${s.id}:revoke`, () => revoke(s))} className={`focus-ring rounded-lg px-3 py-1.5 text-xs font-extrabold ${arm === `${s.id}:revoke` ? 'bg-live text-white' : 'text-[#ff9db3]'}`}>
                  {arm === `${s.id}:revoke` ? 'Tocá de nuevo para dar de baja' : 'Dar de baja'}
                </button>
              </li>
            )
          })}
        </ul>

        {revoked.length > 0 && (
          <details className="group mt-4">
            <summary className="focus-ring cursor-pointer list-none text-sm font-bold text-white/50 [&::-webkit-details-marker]:hidden">
              <span className="mr-2 inline-block transition group-open:rotate-90">›</span>Dados de baja ({revoked.length})
            </summary>
            <ul className="mt-2 space-y-1">
              {revoked.map((s) => (
                <li key={s.id} className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-white/60">{s.full_name}</span>
                  <button type="button" disabled={busy} onClick={armed(`${s.id}:rotate`, () => rotate(s))} className={`focus-ring rounded-lg px-3 py-1 text-xs font-bold ring-1 ${arm === `${s.id}:rotate` ? 'bg-gold text-night ring-gold' : 'ring-white/20'}`}>
                    {arm === `${s.id}:rotate` ? 'Tocá de nuevo' : 'Reactivar (link nuevo)'}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <aside className="order-first space-y-4 lg:sticky lg:top-4 lg:order-none">
        <form onSubmit={add} className="card p-4">
          <h2 className="kicker mb-2">Agregar veedor</h2>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="Nombre y apellido"
            className="focus-ring w-full rounded-xl bg-white/10 px-3 py-2.5 font-bold placeholder:text-white/35"
          />
          <button type="submit" disabled={busy || name.trim().length < 2} className="focus-ring mt-3 w-full rounded-xl bg-gold px-4 py-2.5 font-extrabold text-night disabled:opacity-40">
            Agregar y ver su link
          </button>
        </form>
        <p className="card p-4 text-sm text-white/65">
          Los veedores <b>rotan</b>: en la cancha donde están tocan el partido y lo <b>toman</b>; desde ahí son los únicos que lo cargan. Si a alguien se le apaga el celular, otro lo puede tomar igual (le pide confirmación), o lo cambiás vos desde <b>Partidos → Veedor</b>.
        </p>
      </aside>

      {shown && <LinkModal shown={shown} onClose={() => setShown(null)} />}
    </div>
  )
}

function LinkModal({ shown, onClose }) {
  const [copied, setCopied] = useState(false)
  const msg =
    `¡Hola ${shown.name}! Este es tu link de veedor de la Copa Proud${IS_DEMO ? ' (ENSAYO)' : ''}:\n${shown.link}\n\n` +
    'Abrilo en el celular. En la cancha donde estés, tocá la cancha y "Tomar este partido": desde ahí solo vos cargás los goles y tarjetas de ese partido. No compartas el link.'
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown.link)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl bg-indigo-800 p-5 ring-1 ring-gold/40">
        <p className="kicker mb-1">Link de veedor</p>
        <p className="mb-3 text-xl font-extrabold">{shown.name}</p>
        <p className="mb-3 select-all break-all rounded-xl bg-black/30 p-3 font-mono text-sm text-gold-light">{shown.link}</p>
        <p className="mb-4 text-xs font-bold text-[#ffb3c4]">Este link no se vuelve a mostrar. Si se pierde, generá uno nuevo (el anterior deja de andar).</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={copy} className="focus-ring rounded-xl bg-white/10 px-4 py-2.5 font-extrabold ring-1 ring-white/20">
            {copied ? '✓ Copiado' : 'Copiar link'}
          </button>
          <a href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer" className="focus-ring rounded-xl bg-[#25D366] px-4 py-2.5 text-center font-extrabold text-night">
            Mandar por WhatsApp
          </a>
        </div>
        <button type="button" onClick={onClose} className="focus-ring mt-3 w-full rounded-xl px-4 py-2.5 font-bold text-white/70 ring-1 ring-white/15">
          Listo
        </button>
      </div>
    </div>
  )
}
