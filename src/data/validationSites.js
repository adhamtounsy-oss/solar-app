// Real-world installation database — mirrors solar_validation_v2.py INSTALLATIONS
// Sources: Clean Energy 2024, Gabr ITEES 2020, JKSUS 2021, MDPI Sustainability 2020,
//          ScienceDirect 2021/2022/2019

const CAIRO_TMY_PSH  = [5.28,5.90,6.83,7.39,7.50,7.52,7.50,7.43,7.05,6.27,5.43,4.97];
const CAIRO_TMY_TAMB = [13.5,15.0,18.5,22.5,27.0,29.5,31.0,31.5,28.5,24.0,18.5,14.5];
const CAIRO_SOIL     = [.02,.02,.09,.11,.08,.02,.02,.02,.02,.03,.02,.02];

export const VALIDATION_SITES = [
  {
    id:"EG-01", label:"Cairo ERI Rooftop (30.26 kWp)", country:"Egypt",
    kwp:30.26, gammaPmax:-0.35, noct:44, invEta:97.2,
    soiling: CAIRO_SOIL,
    modelPsh:[3.97,4.60,5.50,5.90,6.10,6.15,6.20,6.33,6.00,5.30,4.30,3.97], // measured ref yield
    modelTamb: CAIRO_TMY_TAMB,
    measSpecYield:1636, measPr:0.8308,
    source:"Clean Energy (Oxford) 2024 [1]", year:"Oct 2022–Sep 2023",
  },
  {
    id:"EG-02", label:"Egypt Residential Multi-site avg", country:"Egypt",
    kwp:10, gammaPmax:-0.40, noct:44, invEta:97.0,
    soiling: CAIRO_SOIL,
    modelPsh: CAIRO_TMY_PSH,
    modelTamb: CAIRO_TMY_TAMB,
    measSpecYield:1756, measPr:0.83,
    source:"Gabr et al., Wiley ITEES 2020 [2]", year:"2019–2022",
  },
  {
    id:"EG-03", label:"Aswan, Egypt (high-resource)", country:"Egypt",
    kwp:10, gammaPmax:-0.40, noct:44, invEta:97.0,
    soiling:[.04,.04,.12,.14,.10,.04,.04,.04,.04,.05,.04,.04],
    modelPsh: CAIRO_TMY_PSH.map(v=>v*1.10),
    modelTamb:[16,18,22,27,32,34,35,35,32,28,22,17],
    measSpecYield:2062, measPr:0.83,
    source:"Gabr et al. [2] + IEA regional data", year:"2019–2021",
  },
  {
    id:"SA-01", label:"Jeddah, Saudi Arabia (12.25 kWp)", country:"Saudi Arabia",
    kwp:12.25, gammaPmax:-0.40, noct:44, invEta:97.5,
    soiling:[.02,.02,.05,.07,.05,.02,.02,.02,.02,.02,.02,.02],
    modelPsh:[5.50,6.20,6.80,7.00,7.10,6.80,6.60,6.50,6.20,5.90,5.60,5.40],
    modelTamb:[23,25,27,30,33,36,37,37,34,31,27,24],
    measSpecYield:1927, measPr:0.78,
    source:"MDPI Sustainability 2020 [4]", year:"SAM model 2018",
  },
  {
    id:"TR-01", label:"Köprübaşı, Turkey (30 kWp)", country:"Turkey",
    kwp:30.0, gammaPmax:-0.45, noct:45, invEta:98.6,
    soiling:[.01,.01,.03,.04,.03,.01,.01,.01,.01,.02,.01,.01],
    modelPsh:[53.65/31,104.18/28,172.56/31,171.96/30,200.88/31,208.17/30,
              230.11/31,215.19/31,170.13/30,142.03/31,85.14/30,63.66/31],
    modelTamb:[-5.2,1.0,7.0,14.0,19.0,24.0,29.0,30.0,25.0,17.0,10.0,2.0],
    measSpecYield:1519.73, measPr:0.8361,
    source:"J. King Saud Univ.-Sci. 2021 [3]", year:"2018",
  },
  {
    id:"DZ-01", label:"Ghardaia, Algeria (1.1 MW Saharan)", country:"Algeria",
    kwp:1100, gammaPmax:-0.40, noct:45, invEta:97.5,
    soiling:[.03,.03,.10,.14,.10,.03,.03,.03,.03,.04,.03,.03],
    modelPsh:[5.80,6.50,7.20,7.80,8.00,8.10,8.00,7.90,7.50,6.80,6.00,5.50],
    modelTamb:[7,9,13,18,23,28,32,32,27,20,13,8],
    measSpecYield:1860, measPr:0.80,
    source:"ScienceDirect 2021 – Algeria Ghardaia [7]", year:"2016",
  },
  {
    id:"MA-01", label:"El Jadida, Morocco (multi-system avg)", country:"Morocco",
    kwp:10, gammaPmax:-0.40, noct:44, invEta:97.0,
    soiling:[.01,.01,.04,.06,.04,.01,.01,.01,.01,.02,.01,.01],
    modelPsh:[4.20,5.20,6.30,6.80,7.20,7.50,7.60,7.20,6.40,5.40,4.40,3.80],
    modelTamb:[10,11,14,16,19,22,25,26,22,18,13,10],
    measSpecYield:1818, measPr:0.8073,
    source:"ScienceDirect 2022 – Morocco El Jadida [8]", year:"2022",
  },
  {
    id:"AE-01", label:"Abu Dhabi, UAE (grid-tied residential)", country:"UAE",
    kwp:10, gammaPmax:-0.40, noct:45, invEta:97.5,
    soiling:[.02,.02,.06,.08,.06,.02,.02,.02,.02,.03,.02,.02],
    modelPsh:[5.50,6.20,7.00,7.60,7.90,8.00,7.90,7.70,7.30,6.70,6.00,5.40],
    modelTamb:[19,21,24,28,33,36,37,37,34,30,25,20],
    measSpecYield:1860, measPr:0.80,
    source:"UAE residential study – MENA literature", year:"2019–2020",
  },
  {
    id:"MR-01", label:"Nouakchott, Mauritania (954 kWp)", country:"Mauritania",
    kwp:954.8, gammaPmax:-0.40, noct:46, invEta:97.0,
    soiling:[.03,.03,.08,.10,.08,.03,.03,.03,.03,.04,.03,.03],
    modelPsh:[6.00,6.50,7.00,7.30,7.50,7.60,7.50,7.40,7.20,7.00,6.40,5.80],
    modelTamb:[20,22,26,29,33,34,32,31,31,30,26,21],
    measSpecYield:1700, measPr:0.75,
    source:"ScienceDirect 2019 – Mauritania Sheikh Zayed [6]", year:"2015–2017",
  },
];

export const DAYS = [31,28,31,30,31,30,31,31,30,31,30,31];
