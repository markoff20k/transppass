import { useId, type CSSProperties } from 'react';
import { VehicleClass, VehicleStatus } from '@app/shared';
import { BusRender } from '@/components/bus/bus-render';

const ORANGE = '#f87509';

/**
 * O Tipê, rosto da ia.Transppass: um robô cuja cabeça é a frente de um ônibus
 * da frota — teto e para-choque laranja, letreiro de LED, para-brisa como
 * visor com os olhos, retrovisores como orelhas — e a esfera laranja do logo
 * da Transppass como antena. Pisca de vez em quando; lendo os dados (live),
 * os olhos varrem o visor, o letreiro corre e a antena acende.
 */
export function IaBot({ size = 32, live = false, className }: { size?: number; live?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <span className={`ia-bot${live ? ' is-live' : ''}${className ? ` ${className}` : ''}`} style={{ '--ia-bot': `${size}px` } as CSSProperties} aria-hidden>
      <svg viewBox="0 0 64 64">
        <defs>
          <linearGradient id={`${id}-head`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.6" stopColor="#f4f4f2" />
            <stop offset="1" stopColor="#dcdcd8" />
          </linearGradient>
          <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3a4049" />
            <stop offset="1" stopColor="#14171b" />
          </linearGradient>
          <radialGradient id={`${id}-ball`} cx="0.35" cy="0.3" r="0.75">
            <stop offset="0" stopColor="#ffb25c" />
            <stop offset="0.55" stopColor={ORANGE} />
            <stop offset="1" stopColor="#d65a00" />
          </radialGradient>
          <clipPath id={`${id}-clip`}>
            <rect x="9" y="15" width="46" height="40" rx="11" />
          </clipPath>
        </defs>

        {/* antena: a esfera do logo */}
        <line x1="32" y1="9" x2="32" y2="16" className="ia-bot__stem" />
        <circle cx="32" cy="7" r="5.2" fill={`url(#${id}-ball)`} className="ia-bot__ball" />

        {/* retrovisores */}
        <path d="M9.5 27 H6.5 Q5 27 5 28.5 V30" className="ia-bot__arm" />
        <rect x="2.4" y="29" width="5.2" height="10" rx="2" className="ia-bot__mirror" />
        <path d="M54.5 27 H57.5 Q59 27 59 28.5 V30" className="ia-bot__arm" />
        <rect x="56.4" y="29" width="5.2" height="10" rx="2" className="ia-bot__mirror" />

        {/* cabeça = frente do ônibus */}
        <rect x="9" y="15" width="46" height="40" rx="11" fill={`url(#${id}-head)`} className="ia-bot__head" />
        <g clipPath={`url(#${id}-clip)`}>
          <rect x="9" y="15" width="46" height="7.5" fill={ORANGE} />
          <rect x="9" y="50" width="46" height="5" fill={ORANGE} />
        </g>
        {/* letreiro */}
        <rect x="19" y="16.6" width="26" height="4.4" rx="1.4" className="ia-bot__sign" />
        <g className="ia-bot__leds">
          <rect x="21.5" y="18" width="3" height="1.6" rx="0.8" />
          <rect x="26.5" y="18" width="5" height="1.6" rx="0.8" />
          <rect x="33.5" y="18" width="3" height="1.6" rx="0.8" />
          <rect x="38.5" y="18" width="3" height="1.6" rx="0.8" />
        </g>
        {/* para-brisa com os olhos */}
        <rect x="13" y="24.5" width="38" height="16" rx="6" fill={`url(#${id}-glass)`} />
        <path d="M16 26.5 L23 26.5 L17 38.5 L15 38.5 Q14.5 38.5 14.5 37.5 V28 Q14.5 26.5 16 26.5 Z" className="ia-bot__glare" />
        <g className="ia-bot__eyes">
          <rect x="21" y="29" width="7" height="7.4" rx="3.5" className="ia-bot__eye" />
          <rect x="36" y="29" width="7" height="7.4" rx="3.5" className="ia-bot__eye" />
        </g>
        {/* faróis e grade */}
        <rect x="14" y="43.6" width="8" height="3.8" rx="1.9" className="ia-bot__lamp" />
        <rect x="42" y="43.6" width="8" height="3.8" rx="1.9" className="ia-bot__lamp" />
        <path d="M27 44.6 Q32 47.6 37 44.6" className="ia-bot__smile" />
      </svg>
    </span>
  );
}

/**
 * A abertura da conversa: o Tipê na garagem, com ônibus da frota passando
 * na rua atrás dele.
 */
export function IaScene() {
  return (
    <div className="ia-scene" aria-hidden>
      <span className="ia-scene__sun" />
      <div className="ia-scene__road">
        <span className="ia-scene__bus ia-scene__bus--a">
          <BusRender vehicleClass={VehicleClass.PADRON_13M} status={VehicleStatus.IN_LINE} width={118} title="" />
        </span>
        <span className="ia-scene__bus ia-scene__bus--b">
          <BusRender vehicleClass={VehicleClass.ARTICULADO_18M} status={VehicleStatus.IN_LINE} width={136} title="" />
        </span>
        <span className="ia-scene__bus ia-scene__bus--c">
          <BusRender vehicleClass={VehicleClass.EPADRON_13M} status={VehicleStatus.IN_LINE} width={118} title="" />
        </span>
        <span className="ia-scene__lane" />
      </div>
      <IaBot size={108} className="ia-scene__bot" />
      <span className="ia-scene__shadow" />
    </div>
  );
}
