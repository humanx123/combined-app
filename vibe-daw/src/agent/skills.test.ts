import { expect, it } from 'vitest';
import { productionSkills, PRODUCER_SKILLS } from './skills';
import { systemPrompt } from './prompts';

it('attaches relevant procedure and genre without every genre or the DSP manual', () => {
  const prompt = productionSkills('Make an 8 bar Lil Peep type beat');
  expect(prompt).toContain('COMPOSE A PHRASE');
  expect(prompt).toContain('EMO RAP');
  expect(prompt).not.toContain('HOUSE:');
  expect(prompt).not.toContain('function process(');
  expect(systemPrompt('agent')).not.toContain(PRODUCER_SKILLS.custom_effect);
});

it('gives mix and selected-note edits specific procedures instead of a new-song recipe', () => {
  const prompt = productionSkills('Make these notes quieter', true);
  expect(prompt).toContain('EDIT ONLY THE SELECTED PHRASE');
  expect(prompt).toContain('REPAIR A MIX');
  expect(prompt).not.toContain('COMPOSE A PHRASE');
});

it.each([
  ['UK drill beat', 'DRILL:'], ['deep house track', 'HOUSE:'],
  ['lofi loop', 'LO-FI / BOOM BAP:'], ['neo-soul loop', 'R&B / NEO-SOUL:'],
  ['ambient texture, no drums', 'AMBIENT:'], ['trap beat', 'TRAP:'],
])('routes %s to one concise genre guide', (request, expected) => {
  const prompt = productionSkills(request);
  expect(prompt).toContain(expected);
  expect(prompt.length).toBeLessThan(4000);
});

it('keeps routine guidance small and gives exact timing conventions', () => {
  const prompt = productionSkills('Write a melody');
  expect(prompt).toContain('32 beats');
  expect(PRODUCER_SKILLS.rhythm).toContain('........x.......');
  expect(PRODUCER_SKILLS.arrange).toContain('from_bar=1,to_bar=9');
  expect(systemPrompt('agent').length + prompt.length).toBeLessThan(16000);
});

it('does not load a drum procedure for no-drums ambient or a composition guide for simple inspection', () => {
  expect(productionSkills('Make an ambient texture, no drums')).not.toContain('DRUMS AND BASS');
  expect(productionSkills('What is the current tempo?')).not.toContain('COMPOSE A PHRASE');
});
