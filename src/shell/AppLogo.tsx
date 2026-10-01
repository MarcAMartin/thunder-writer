import logo64 from '../assets/brand/logo-64.png'
import logo128 from '../assets/brand/logo-128.png'
import logo192 from '../assets/brand/logo-192.png'

interface AppLogoProps {
  /** Rendered size in CSS pixels (square). */
  size?: number
  className?: string
}

/**
 * Thunder Writer's app icon (the husky with the bolt), as used in page headers.
 * Decorative: the surrounding link or heading carries the name. The same art
 * is the favicon and home-screen icon (public/, generated from the brand sheet).
 */
export function AppLogo({ size = 28, className }: AppLogoProps) {
  return (
    <img
      className={className ? `tw-logo ${className}` : 'tw-logo'}
      src={logo128}
      srcSet={`${logo64} 64w, ${logo128} 128w, ${logo192} 192w`}
      sizes={`${size}px`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      decoding="async"
      draggable={false}
    />
  )
}
