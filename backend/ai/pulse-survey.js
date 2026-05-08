// Enterprise Pulse Survey generation.
//
// Two flows per the brief:
//   - generate-single: 5 questions for a single signal/topic
//   - generate-custom: 2-10 questions across multiple selected topics
//
// Both reply in strict JSON; the frontend mutates the questions array in
// memory (edit/delete/add) before the user "sends" the survey.

const ant = require('./anthropic-client');

function buildSinglePrompt({ signal_name, category, probability, industry_label }) {
  return 'Generate exactly 5 simple, plain-language survey questions about this topic for a professional / organization audience.\n\n'
    + 'Topic: ' + signal_name + '\n'
    + 'Category: ' + (industry_label || category || 'Enterprise') + '\n'
    + (probability != null ? 'Current value: ' + probability + '%\n' : '')
    + '\nRules:\n'
    + '- Keep each question short, clear, and easy to answer (one sentence, no jargon).\n'
    + '- Take the topic literally and build questions directly around it.\n'
    + '- Ask what a working professional would reasonably know or have an opinion on (awareness, expectations, likelihood, concern level, organizational impact).\n'
    + '- No "CRO lens", no "gap between leadership and frontline" framing, no compound questions.\n'
    + '- Mix types: 2 Likert scale (1-5), 2 Yes/No, 1 open-ended.\n\n'
    + 'Reply ONLY with valid JSON, no markdown:\n'
    + '{"questions":['
    + '{"num":1,"text":"question text","type":"scale","low":"Not at all","high":"Extremely"},'
    + '{"num":2,"text":"question text","type":"yesno"},'
    + '{"num":3,"text":"question text","type":"scale","low":"Very unlikely","high":"Very likely"},'
    + '{"num":4,"text":"question text","type":"yesno"},'
    + '{"num":5,"text":"question text","type":"open","placeholder":"Share your thoughts…"}'
    + '],"industry_context":"one short sentence on why this topic is relevant to ' + (industry_label || 'these') + ' professionals"}';
}

function buildCustomPrompt({ survey_name, topics, sector }) {
  const count = Math.min((topics || []).length * 2, 10);
  const list = (topics || []).map((t, i) => (i + 1) + '. ' + t.sig + ' [' + t.cat + ']').join('\n');
  return 'Generate exactly ' + count + ' simple, plain-language survey questions covering the '
    + (topics || []).length + ' topic' + ((topics || []).length !== 1 ? 's' : '')
    + ' below, for a professional / organization audience.\n\n'
    + 'Survey name: ' + (survey_name || 'Custom Survey') + '\n'
    + (sector ? 'Sector: ' + sector + '\n' : '')
    + 'Topics:\n' + list + '\n\n'
    + 'Rules:\n'
    + '- Keep each question short, clear, and easy to answer (one sentence, no jargon).\n'
    + '- Take each topic literally and build questions directly around it.\n'
    + '- Cover every selected topic with at least one question.\n'
    + '- Ask what a working professional would reasonably know or have an opinion on (awareness, expectations, likelihood, concern level, organizational impact).\n'
    + '- No "CRO lens", no "gap between leadership and frontline" framing, no compound questions.\n'
    + '- Mix types: roughly half scale (1-5), quarter yes/no, quarter open-ended.\n\n'
    + 'Reply ONLY with valid JSON, no markdown:\n'
    + '{"survey_title":"' + (survey_name || 'Survey') + ' (refined title, max 8 words)",'
    + '"questions":[{"num":1,"text":"...","type":"scale|yesno|open","low":"...","high":"...","placeholder":"...","topic":"topic this covers"}],'
    + '"summary":"one short sentence describing what this survey covers"}';
}

async function generateSingle(req) {
  const prompt = buildSinglePrompt(req || {});
  const text = await ant.sendMessage({ prompt, maxTokens: 700 });
  const parsed = ant.parseJSONFromResponse(text);
  return {
    questions: Array.isArray(parsed.questions) ? parsed.questions : [],
    industry_context: parsed.industry_context || ''
  };
}

async function generateCustom(req) {
  const prompt = buildCustomPrompt(req || {});
  const text = await ant.sendMessage({ prompt, maxTokens: 900 });
  const parsed = ant.parseJSONFromResponse(text);
  return {
    survey_title: parsed.survey_title || (req && req.survey_name) || 'Survey',
    questions: Array.isArray(parsed.questions) ? parsed.questions : [],
    summary: parsed.summary || ''
  };
}

module.exports = { generateSingle, generateCustom };
