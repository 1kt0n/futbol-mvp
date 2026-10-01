import { useSearchParams } from 'react-router-dom'
import { useI18n } from '../i18n/I18nProvider.jsx'
import { CUPS } from '../lib/model.js'
import { Bracket } from '../components/Bracket.jsx'
import { SectionTitle } from '../components/Layout.jsx'

const TAB = {
  ORO: 'bg-gradient-to-b from-[#fff3c4] via-gold to-gold-deep text-night',
  PLATA: 'bg-gradient-to-b from-white via-silver to-[#8d90a3] text-night',
  BRONCE: 'bg-gradient-to-b from-[#f3c79c] via-bronze to-[#8a4e22] text-night',
}

export default function Cups() {
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const cup = CUPS.includes(params.get('copa')) ? params.get('copa') : 'ORO'
  return (
    <>
      <SectionTitle kicker={t('common.knockout')} title={t('nav.cups')} />
      <div className="mb-3 flex flex-wrap gap-2" role="tablist">
        {CUPS.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={c === cup}
            onClick={() => setParams(c === 'ORO' ? {} : { copa: c }, { replace: true })}
            className={`focus-ring rounded-full px-4 py-2 text-sm font-extrabold transition ${c === cup ? TAB[c] : 'bg-white/5 text-white/70 ring-1 ring-white/10 hover:text-white'}`}
          >
            {t(`cup.${c}`)}
          </button>
        ))}
      </div>
      <p className="mb-6 text-sm text-white/55">{t(`cup.${cup}_desc`)}</p>
      <Bracket key={cup} cup={cup} />
    </>
  )
}
