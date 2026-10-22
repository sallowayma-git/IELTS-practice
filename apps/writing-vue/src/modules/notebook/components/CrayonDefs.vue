<template>
  <svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <filter id="crayon-wax" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.15 0.2" numOctaves="2" seed="7" result="noise" />
      <feComponentTransfer in="noise" result="grain">
        <feFuncA type="linear" slope="1.5" intercept="0.3" />
      </feComponentTransfer>
      <feComposite in="SourceGraphic" in2="grain" operator="in" result="waxed" />
      <feDisplacementMap in="waxed" in2="noise" scale="0.6" xChannelSelector="R" yChannelSelector="G" />
    </filter>
    <!-- Mascot filter: grain almost opaque, barely any displacement. -->
    <filter id="crayon-wax-soft" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.15 0.2" numOctaves="2" seed="7" result="noise" />
      <feComponentTransfer in="noise" result="grain">
        <feFuncA type="linear" slope="1" intercept="0.75" />
      </feComponentTransfer>
      <feComposite in="SourceGraphic" in2="grain" operator="in" result="waxed" />
      <feDisplacementMap in="waxed" in2="noise" scale="0.3" xChannelSelector="R" yChannelSelector="G" />
    </filter>
  </svg>
</template>
