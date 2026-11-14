// L'enseigne ON AIR du studio (layout.ts, motifs « onair » et « onair-allume »). Le tournage est une scène de la
// simulation : elle ne s'allume que dans /demo, et seulement quand L tourne vraiment (arrêté au studio, studioOn du
// moteur). Le reste du temps, jour et nuit, elle est éteinte : grise, sans éclat (rien de faux qui semble réel).
export const onAirAllume = (demo: boolean, studioOn: boolean | undefined) => demo && !!studioOn;
