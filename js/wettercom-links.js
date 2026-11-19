// Static links only: opening a route detail never triggers a weather request.
const HISTORY = {
  'hochalmblick': ['Rauris', 'https://at.wetter.com/wetter_aktuell/rueckblick/oesterreich/wetterstation-rauris/ATXXX0156.html'],
  'selbhorn-herzogsteig': ['Saalfelden am Steinernen Meer', 'https://www.wetter.com/wetter_aktuell/rueckblick/oesterreich/saalfelden-am-steinernen-meer/ATAT30531.html'],
  'geiler-hengst': ['Ternberg', 'https://at.wetter.com/wetter_aktuell/rueckblick/oesterreich/ternberg/ATAT30674.html'],
  'bert-rinesch': ['Hinterstoder', 'https://at.wetter.com/wetter_aktuell/rueckblick/oesterreich/hinterstoder/ATAT30227.html'],
  'wilder-hund': ['Saalfelden am Steinernen Meer', 'https://www.wetter.com/wetter_aktuell/rueckblick/oesterreich/saalfelden-am-steinernen-meer/ATAT30531.html'],
  'nackter-hund': ['Saalfelden am Steinernen Meer', 'https://www.wetter.com/wetter_aktuell/rueckblick/oesterreich/saalfelden-am-steinernen-meer/ATAT30531.html'],
  'franzl-huettschlag': ['Hüttschlag', 'https://www.wetter.com/wetter_aktuell/rueckblick/oesterreich/huettschlag/ATAT30253.html'],
  'bella-cascinaia': ['Obertauern', 'https://at.wetter.com/wetter_aktuell/rueckblick/oesterreich/obertauern/ATAT30441.html'],
  'irg-ii': ['Ramsau am Dachstein', 'https://at.wetter.com/wetter_aktuell/rueckblick/oesterreich/wetterstation-ramsau-dachstein/ATXXX0159.html'],
  'spielmaeuer-felix': ['Mariazell', 'https://at.wetter.com/wetter_aktuell/rueckblick/oesterreich/mariazell/ATAT20261.html'],
  'franzi-reiteralm': ['Schladming', 'https://www.wetter.com/wetter_aktuell/rueckblick/oesterreich/schladming/ATAT20356.html'],
  'schlicker-ochsenwand': ['Fulpmes', 'https://www.wetter.com/wetter_aktuell/rueckblick/oesterreich/fulpmes/ATAT30154.html'],
  'innsbrucker': ['Innsbruck', 'https://www.wetter.com/wetter_aktuell/rueckblick/oesterreich/innsbruck/ATAT30256.html'],
  'achensee-5-gipfel': ['Achenkirch', 'https://www.wetter.com/wetter_aktuell/rueckblick/oesterreich/achenkirch/ATAT30004.html'],
  'kaiser-franz-joseph-seemauer': ['Mariazell', 'https://at.wetter.com/wetter_aktuell/rueckblick/oesterreich/mariazell/ATAT20261.html'],
  'koenigsjodler': ['Mühlbach am Hochkönig', 'https://www.wetter.com/wetter_aktuell/rueckblick/oesterreich/muehlbach-am-hochkoenig/ATAT30387.html'],
  'der-johann': ['Ramsau am Dachstein', 'https://at.wetter.com/wetter_aktuell/rueckblick/oesterreich/wetterstation-ramsau-dachstein/ATXXX0159.html'],
  'tassilo-schermberg': ['Hinterstoder', 'https://at.wetter.com/wetter_aktuell/rueckblick/oesterreich/hinterstoder/ATAT30227.html'],
  'traunsee': ['Gmunden', 'https://www.wetter.com/wetter_aktuell/rueckblick/oesterreich/gmunden/ATAT30175.html'],
  'lindwurm': ['Bad Goisern am Hallstättersee', 'https://www.wetter.com/wetter_aktuell/rueckblick/oesterreich/wetterstation-bad-goisern/ATXXX0161.html'],
  'suedostsporn': ['Hinterstoder', 'https://at.wetter.com/wetter_aktuell/rueckblick/oesterreich/hinterstoder/ATAT30227.html'],
  'hochkogel': ['Ebensee', 'https://at.wetter.com/wetter_aktuell/rueckblick/oesterreich/ebensee/ATAT30109.html'],
  'loser-sisi': ['Bad Aussee', 'https://at.wetter.com/wetter_aktuell/rueckblick/oesterreich/wetterstation-bad-aussee/ATXXX0163.html'],
  'grandlspitz': ['Mühlbach am Hochkönig', 'https://www.wetter.com/wetter_aktuell/rueckblick/oesterreich/muehlbach-am-hochkoenig/ATAT30387.html'],
  'anna': ['Ramsau am Dachstein', 'https://at.wetter.com/wetter_aktuell/rueckblick/oesterreich/wetterstation-ramsau-dachstein/ATXXX0159.html'],
  'donnerkogel': ['Gosau', 'https://at.wetter.com/wetter_aktuell/rueckblick/oesterreich/gosau/ATAT30181.html'],
  'pfeilspitzwand': ['Mayrhofen', 'https://at.wetter.com/wetter_aktuell/rueckblick/oesterreich/mayrhofen/ATAT30364.html'],
  'poppenberg': ['Hinterstoder', 'https://at.wetter.com/wetter_aktuell/rueckblick/oesterreich/hinterstoder/ATAT30227.html'],
  'raeuberleiter': ['Berchtesgaden', 'https://www.wetter.com/wetter_aktuell/rueckblick/deutschland/berchtesgaden/DE0000965.html'],
  'servus-stef': ['Berchtesgaden', 'https://www.wetter.com/wetter_aktuell/rueckblick/deutschland/berchtesgaden/DE0000965.html'],
  'gipfelwand': ['Berchtesgaden', 'https://www.wetter.com/wetter_aktuell/rueckblick/deutschland/berchtesgaden/DE0000965.html'],
  'mammut-klettersteig-beisteinmauer': ['Ternberg', 'https://at.wetter.com/wetter_aktuell/rueckblick/oesterreich/ternberg/ATAT30674.html'],
  'grossalber-klettersteig-beisteinmauer': ['Ternberg', 'https://at.wetter.com/wetter_aktuell/rueckblick/oesterreich/ternberg/ATAT30674.html'],
  'wilde-gams': ['Saalfelden am Steinernen Meer', 'https://www.wetter.com/wetter_aktuell/rueckblick/oesterreich/saalfelden-am-steinernen-meer/ATAT30531.html'],
  'isidor-klettersteig-gruenstein': ['Berchtesgaden', 'https://www.wetter.com/wetter_aktuell/rueckblick/deutschland/berchtesgaden/DE0000965.html']
};

export const DEFAULT_RAINFALL_HISTORY_URL = 'https://www.wetter.com/';

export function rainfallHistoryForRoute(routeId) {
  const [place, url] = HISTORY[routeId] || [];
  return { place: place || null, url: url || DEFAULT_RAINFALL_HISTORY_URL };
}
