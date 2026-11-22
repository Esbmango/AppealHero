import type { Content, Part } from '@google/genai';
import { LANGS } from '@appealhero/shared';
import { config } from '../config';
import { publishMetrics, say, type Ctx } from '../ctx';
import type { CaseRecord } from '../types';
import { latestFact } from './facts';
import { gemini, recordUsage } from './llm';
import { FINES, formatBoston } from './rules';
import { TOOL_DECLARATIONS, runTool, type ToolOutcome } from './tools';

export type TurnInput =
  | { kind: 'start' }
  | { kind: 'user'; text: string; evidenceIds: string[] }
  | { kind: 'decision'; choice: 'appeal_anyway' };

/** One agent turn. Gemini decides inside the INVESTIGATING state; code owns every transition. */
export async function investigate(ctx: Ctx, caseId: string, input: TurnInput) {
  const t0 = Date.now();
  try {
    if (config.aiMode === 'gemini') await geminiTurn(ctx, caseId, input);
    else await fakeTurn(ctx, caseId, input);
  } finally {
    ctx.store.mutate(caseId, (c) => {
      c.metrics.agentMs += Date.now() - t0;
    });
    publishMetrics(ctx, caseId);
  }
}

// ---------------------------------------------------------------- Gemini driver
const MAX_STEPS = 8;

function systemPrompt(c: CaseRecord): string {
  const facts = c.facts.map((f) => `${f.id} | ${f.key} | ${f.label} = ${f.note ?? f.value} | ${f.provenance} | ${f.status}`).join('\n');
  const photos = c.evidence.filter((e) => e.kind !== 'audio').map((e) => `${e.id} (${e.kind})`).join(', ') || 'none';
  return [
    'You are AppealHero. You help a person decide whether and how to appeal a City of Boston parking ticket, then prepare the appeal for THEIR approval. You are not a lawyer and never promise outcomes.',
    `Talk to the user in ${LANGS[c.lang as keyof typeof LANGS] ?? c.lang}. 1–3 short sentences. Ask exactly ONE question at a time with ask_user, and only for information that is actually missing.`,
    'Grounding: meter hours, holidays, fines and deadlines come ONLY from check_rule. Photo findings come ONLY from analyze_evidence. What the user says is recorded with record_fact. Never state a fact you did not get from a tool or the fact list.',
    'Honesty: if there is no lawful ground (e.g. a hydrant ticket with correct vehicle details), call propose_outcome with recommendation=PAY and explain the fine, late penalty and deadline. Never help the user claim something their own evidence contradicts.',
    "To APPEAL you need a dispute_reason, grounds citing fact ids, and the appellant's full name, mailing address and email (ask, then record_fact).",
    `Violation type: ${c.violationType ?? 'unknown'}. Photos: ${photos}.`,
    `Facts (id | key | label = value | provenance | status):\n${facts}`,
  ].join('\n\n');
}

function userTurnText(input: TurnInput): string {
  if (input.kind === 'start') return 'The ticket has been extracted. Start the investigation.';
  if (input.kind === 'decision')
    return 'The user chose to appeal anyway despite your recommendation. Prepare an honest appeal using only facts they stated; if they have not stated a reason, ask for it. Never invent grounds.';
  return `User: ${input.text || '(no text)'}${input.evidenceIds.length ? `\n(Uploaded photo evidence: ${input.evidenceIds.join(', ')})` : ''}`;
}

async function geminiTurn(ctx: Ctx, caseId: string, input: TurnInput) {
  ctx.store.mutate(caseId, (c) => {
    const last = c.llm.contents.at(-1);
    // Merge into the previous user content (function responses) instead of sending two user turns in a row.
    if (last?.role === 'user') last.parts = [...(last.parts ?? []), { text: userTurnText(input) }];
    else c.llm.contents.push({ role: 'user', parts: [{ text: userTurnText(input) }] });
  });
  for (let step = 0; step < MAX_STEPS; step++) {
    const c = ctx.store.must(caseId);
    const res = await gemini().models.generateContent({
      model: config.geminiModel,
      contents: c.llm.contents,
      config: { systemInstruction: systemPrompt(c), tools: [{ functionDeclarations: TOOL_DECLARATIONS }] },
    });
    const u = res.usageMetadata;
    recordUsage(ctx, caseId, u?.promptTokenCount ?? 0, (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0));
    const content: Content | undefined = res.candidates?.[0]?.content;
    if (!content) {
      say(ctx, caseId, c.lang === 'zh' ? '我没能处理这一步，请再发一次。' : 'I could not process that — please try again.');
      return;
    }
    // Append the model content verbatim: Gemini 3 requires its thought signatures back on the next call.
    ctx.store.mutate(caseId, (r) => r.llm.contents.push(content));
    const calls = res.functionCalls ?? [];
    if (!calls.length) {
      const text = res.text?.trim();
      if (text) say(ctx, caseId, text);
      return;
    }
    const parts: Part[] = [];
    let endTurn = false;
    for (const call of calls) {
      const out: ToolOutcome = await runTool(ctx, caseId, call.name ?? '', (call.args ?? {}) as Record<string, unknown>);
      parts.push({ functionResponse: { id: call.id, name: call.name, response: out.isError ? { error: out.result } : { result: out.result } } });
      if (out.endTurn) endTurn = true;
    }
    ctx.store.mutate(caseId, (r) => r.llm.contents.push({ role: 'user', parts }));
    if (endTurn) return;
  }
  say(ctx, caseId, ctx.store.must(caseId).lang === 'zh' ? '这一步我需要你的帮助：请补充一下情况。' : 'I need your help to continue — could you add some detail?');
}

// ---------------------------------------------------------------- Fake driver
/**
 * Deterministic scripted agent using the SAME tools and validation as the Gemini driver.
 * Lets the UI, executor and demos run with no key and no network. Not a substitute for the real agent.
 */
async function fakeTurn(ctx: Ctx, caseId: string, input: TurnInput) {
  const tool = (name: string, args: Record<string, unknown>) => runTool(ctx, caseId, name, args);
  const c0 = ctx.store.must(caseId);
  const zh = c0.lang === 'zh';
  const T = (zhText: string, enText: string) => (zh ? zhText : enText);
  const fact = (key: string) => latestFact(ctx.store.must(caseId), key);
  const ask = async (awaiting: string, q: string, qEn: string, expects: 'text' | 'photo' | 'choice', options?: string[]) => {
    ctx.store.mutate(caseId, (r) => {
      r.fake.awaiting = awaiting;
    });
    await tool('ask_user', { question: q, question_en: qEn, expects, options, why: awaiting });
  };
  const awaiting = c0.fake.awaiting;
  const text = input.kind === 'user' ? input.text : '';

  if (input.kind === 'start') {
    const fine = FINES[c0.violationType ?? 'OTHER']?.fine;
    say(
      ctx,
      caseId,
      T(
        `我读到了这张罚单：${fact('violation')?.value}${fine ? `（$${fine}）` : ''}，${formatBoston(fact('issuedAt')?.value ?? '', 'zh')}，${fact('location')?.value}。我先核对官方规则。`,
        `I read the ticket: ${fact('violation')?.value}${fine ? ` ($${fine})` : ''}, ${formatBoston(fact('issuedAt')?.value ?? '')}, ${fact('location')?.value}. Checking the official rules first.`,
      ),
    );
  }

  // Answers to earlier questions
  if (input.kind === 'user' && awaiting === 'contact' && text) {
    const lines = text.split(/\n|;|；/).map((s) => s.trim()).filter(Boolean);
    const email = lines.find((l) => /@/.test(l));
    const name = lines.find((l) => l !== email && !/\d/.test(l)) ?? lines[0];
    const address = lines.find((l) => l !== email && l !== name);
    if (name) await tool('record_fact', { key: 'fullName', label: 'Full name', value: name, provenance: 'USER_TEXT' });
    if (address) await tool('record_fact', { key: 'mailingAddress', label: 'Mailing address', value: address, provenance: 'USER_TEXT' });
    if (email) await tool('record_fact', { key: 'email', label: 'Email', value: email, provenance: 'USER_TEXT' });
  }
  if (input.kind === 'user' && awaiting === 'account' && text)
    await tool('record_fact', { key: 'userAccount', label: 'Your account', value: text, provenance: 'USER_TEXT' });

  const proposeAppeal = async (reason: string, grounds: { text_en: string; fact_ids: string[] }[], summary: string) => {
    const missing = ['fullName', 'mailingAddress', 'email'].filter((k) => !fact(k)?.value);
    if (missing.length)
      return ask(
        'contact',
        '为了提交申诉，请告诉我你的全名、邮寄地址和邮箱（每项一行）。',
        'To file the appeal I need your full name, mailing address and email (one per line).',
        'text',
      );
    await tool('propose_outcome', { recommendation: 'APPEAL', dispute_reason: reason, summary_user_lang: summary, grounds });
  };
  const proposePay = async (why: string, whyEn: string, factIds: string[]) => {
    const f = FINES[c0.violationType ?? 'OTHER'];
    await tool('check_rule', { rule: 'appeal_deadline' });
    await tool('propose_outcome', {
      recommendation: 'PAY',
      summary_user_lang: T(
        `我核对后认为这张罚单没有站得住的申诉理由：${why}。建议在 21 天期限内缴纳${f ? ` $${f.fine}` : ''}，逾期会加收${f ? ` $${f.late}` : '滞纳金'}。如果你仍想申诉，也可以继续，但我不会替你编造理由。`,
        `I don't see a valid ground to appeal: ${whyEn}. Paying within 21 days avoids the late penalty${f ? ` ($${f.late})` : ''}. You can still appeal, but I won't invent reasons.`,
      ),
      grounds: [{ text_en: whyEn, fact_ids: factIds }],
    });
  };

  const account = fact('userAccount');
  if (input.kind === 'decision') {
    if (!account) return ask('account', '请用你自己的话说明为什么要申诉。', 'In your own words, why do you want to appeal?', 'text');
    return proposeAppeal('OTHER', [{ text_en: `In my own words: ${account.note ?? account.value}`, fact_ids: [account.id] }], T('好的，我只用你本人的陈述起草申诉。', "OK — I'll draft the appeal using only your own statement."));
  }

  switch (c0.violationType) {
    case 'METER': {
      const free = (await tool('check_rule', { rule: 'meter_free_day' })).result as { result: unknown; factId: string };
      const hours = (await tool('check_rule', { rule: 'meter_hours_in_effect' })).result as { result: unknown; factId: string; detail: string };
      const issued = fact('issuedAt');
      if (free.result === true || hours.result === false) {
        return proposeAppeal(
          'METER_NOT_IN_EFFECT',
          [
            {
              text_en: `${hours.detail}. Boston parking meters operate Monday through Saturday from 8 a.m. to 8 p.m. and are free on Sundays and City holidays, so no meter fee was due when this ticket was issued.`,
              fact_ids: [issued?.id, free.factId, hours.factId].filter(Boolean) as string[],
            },
          ],
          T('好消息：罚单开在计时器免费的时段（周日/市政假日）。我已经按官方规则起草了申诉，请核对。', 'Good news: the ticket was issued when meters are free. I drafted the appeal from the official rule — please review.'),
        );
      }
      const photo = ctx.store.must(caseId).evidence.find((e) => e.kind === 'evidence_photo' && !ctx.store.must(caseId).fake.analyzed.includes(e.id));
      if (photo) {
        await tool('analyze_evidence', { evidence_id: photo.id, extract: 'paid_until' });
        const cover = (await tool('check_rule', { rule: 'receipt_covers_ticket' })).result as { result: unknown; factId: string; detail: string };
        if (cover.result === true)
          return proposeAppeal(
            'PAID',
            [{ text_en: `I paid for parking. ${cover.detail}.`, fact_ids: [cover.factId, fact('paidUntil')?.id, issued?.id].filter(Boolean) as string[] }],
            T('付款记录覆盖了罚单时间，申诉理由成立。我起草好了，请核对。', 'Your receipt covers the ticket time. Draft ready for review.'),
          );
        return proposePay('付款有效期没有覆盖罚单开具时间', 'the payment period does not cover the time the ticket was issued', [cover.factId]);
      }
      if (input.kind === 'user' && /没付|没有付|didn.?t pay|did not pay|^no\b/i.test(text))
        return proposePay('当时没有付费，且不在免费时段', 'parking was not paid and meters were in effect', [hours.factId]);
      return ask('paid', '你当时付过停车费吗？如果是用 ParkBoston 付的，请上传付款记录截图。', 'Did you pay? If you used ParkBoston, please upload a screenshot of the payment.', 'photo');
    }
    case 'HYDRANT': {
      if (awaiting === 'vehicleMatch' && input.kind === 'user') {
        if (/不一致|不对|不是|wrong|no/i.test(text)) {
          await tool('record_fact', { key: 'vehicleMatches', label: 'Vehicle details on ticket match my car', value: 'No — the ticket shows a different vehicle', provenance: 'USER_TEXT' });
          const vm = fact('vehicleMatches');
          return proposeAppeal(
            'VEHICLE_INFO',
            [{ text_en: 'The vehicle details recorded on this ticket do not match my vehicle.', fact_ids: [vm!.id, fact('plateNumber')!.id] }],
            T('车辆信息不符可以作为申诉理由。草稿已备好，请核对。', 'A vehicle mismatch is a valid ground. Draft ready.'),
          );
        }
        const fine = (await tool('check_rule', { rule: 'fine_amount' })).result as { factId: string };
        return proposePay('消防栓前停车没有豁免，且罚单车辆信息与你的车一致', 'parking at a hydrant has no exemption and the vehicle details are correct', [fine.factId]);
      }
      return ask('vehicleMatch', '罚单上的车牌和车型跟你的车一致吗？', 'Do the plate and vehicle on the ticket match your car?', 'choice', zh ? ['一致', '不一致'] : ['Yes', 'No']);
    }
    case 'RESIDENT_PERMIT': {
      const photo = ctx.store.must(caseId).evidence.find((e) => e.kind === 'evidence_photo' && !ctx.store.must(caseId).fake.analyzed.includes(e.id));
      if (photo) {
        await tool('analyze_evidence', { evidence_id: photo.id, extract: 'sign_text' });
        const vis = fact('signVisibility');
        if (vis?.value !== 'clear')
          return proposeAppeal(
            'SIGNAGE',
            [{ text_en: 'The resident-permit sign at this location was partially obscured and not readable from the parking space, as shown in the attached photo.', fact_ids: [vis!.id, fact('signText')!.id] }],
            T('照片显示路牌被遮挡，可以申诉。草稿已备好。', 'The photo shows an obscured sign — draft ready.'),
          );
        return proposePay('路牌清晰可见且适用', 'the resident-permit sign is clearly visible and applies', [vis.id]);
      }
      return ask('sign', '现场的 Resident Permit 路牌清楚吗？请拍一张路牌照片。', 'Was the resident-permit sign clear? Please upload a photo of it.', 'photo');
    }
    default: {
      if (account)
        return proposeAppeal('OTHER', [{ text_en: `In my own words: ${account.note ?? account.value}`, fact_ids: [account.id] }], T('我根据你的陈述起草了申诉，请核对。', 'Draft based on your statement — please review.'));
      return ask('account', '请简单描述当时的情况。', 'Please briefly describe what happened.', 'text');
    }
  }
}
