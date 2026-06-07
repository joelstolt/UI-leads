/**
 * redo-pilot/config.js — centrala tröskelvärden för sweet spot + screening.
 *
 * Ändras här en gång — alla 5 scripten läser härifrån.
 */

module.exports = {
  // Sweet spot — realistisk för redovisningsbranschen
  REVENUE_MIN: 2_000_000, // 2 MSEK
  REVENUE_MAX: 15_000_000, // 15 MSEK
  EMPLOYEES_MIN: 2,
  EMPLOYEES_MAX: 10,

  // Städer i våg 1 (Skåne-triangeln)
  CITIES: ["Malmö", "Helsingborg", "Lund"],

  // Discovery-queries
  QUERIES: ["redovisningsbyrå", "bokföringsbyrå", "revisionsbyrå"],
};
