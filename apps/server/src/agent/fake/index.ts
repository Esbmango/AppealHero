import { personalFacts } from '../runtime/circumstances';
import { readDemoTruth } from '../perception/demoTruth';
import { say, type Ctx } from '../../core/ctx';
import { latestFact } from '../policy/facts';
import { fineFor, formatBoston } from '../rules/boston';
import { runTool } from '../tools';
import type { TurnInput } from '../runtime/investigate';

/**
 * Deterministic scripted agent using the SAME tools and validation as the Gemini driver.
 * Lets the UI, executor and demos run with no key and no network. Not a substitute for the real agent.
 */
export async function fakeTurn(ctx: Ctx, caseId: string, input: TurnInput) {
  const tool = (name: string, args: Record<string, unknown>) => runTool(ctx, caseId, name, args);
  const c0 = ctx.store.must(caseId);
  const zh = c0.lang === 'zh';
  const T = (zhText: string, enText: string, esText: string) => (zh ? zhText : c0.lang === 'es' ? esText : enText);
  const fact = (key: string) => latestFact(ctx.store.must(caseId), key);
  const ask = async (awaiting: string, q: string, qEn: string, expects: 'text' | 'photo' | 'choice', options?: string[]) => {
    ctx.store.mutate(caseId, (r) => {
      r.fake.awaiting = awaiting;
    });
    const spanish: Record<string, string> = {
      paid: '¿Pagaste el estacionamiento? Puedes subir una foto del recibo de pago.',
      contact: 'Para presentar la apelación necesito tu nombre completo, dirección postal y correo electrónico, uno por línea.',
      sign: '¿Se veía bien la señal de estacionamiento residencial? Puedes subir una foto.',
      vehicleMatch: '¿Coinciden la placa y el vehículo de la multa con los tuyos?',
      account: 'Describe con tus propias palabras qué pasó y por qué deseas apelar.',
    };
    await tool('ask_user', { question: T(q, qEn, spanish[awaiting] ?? q), question_en: qEn, expects, options, why: awaiting });
  };
  const awaiting = c0.fake.awaiting;
  const text = input.kind === 'user' ? input.text : '';

  if (input.kind === 'start') {
    const fine = fineFor(fact('violation')?.value, Number(fact('fineAmount')?.value) || undefined, c0.violationType).fine;
    say(
      ctx,
      caseId,
      T(
        `我读到了这张罚单：${fact('violation')?.value}${fine ? `（$${fine}）` : ''}，${formatBoston(fact('issuedAt')?.value ?? '', 'zh')}，${fact('location')?.value}。我先核对官方规则。`,
        `I read the ticket: ${fact('violation')?.value}${fine ? ` ($${fine})` : ''}, ${formatBoston(fact('issuedAt')?.value ?? '')}, ${fact('location')?.value}. Checking the official rules first.`,
        'Revisaré las reglas aplicables a esta multa.',
      ),
    );
  }

  // Answers to earlier questions
  if (input.kind === 'user' && awaiting === 'contact' && text) {
    const lines = text
      .split(/\n|;|；/)
      .map((s) => s.trim())
      .filter(Boolean);
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
  const personal = personalFacts(c0);
  const requestDiscretion = () =>
    proposeAppeal(
      'OTHER',
      personal.map((f) => ({ text_en: f.note ?? f.value, fact_ids: [f.id] })),
      '',
    );
  const proposePay = async (why: string, whyEn: string, factIds: string[]) => {
    if (personal.length) return requestDiscretion();
    const f0 = fineFor(fact('violation')?.value, Number(fact('fineAmount')?.value) || undefined, c0.violationType);
    const f = f0.fine !== undefined ? { fine: f0.fine, late: f0.late } : undefined;
    await tool('check_rule', { rule: 'appeal_deadline' });
    await tool('propose_outcome', {
      recommendation: 'PAY',
      summary_user_lang: T(
        `我核对后认为这张罚单没有站得住的申诉理由：${why}。建议在 21 天期限内缴纳${f ? ` $${f.fine}` : ''}，逾期会加收${f ? ` $${f.late}` : '滞纳金'}。如果你仍想申诉，也可以继续，但我不会替你编造理由。`,
        `I don't see a valid ground to appeal: ${whyEn}. Paying within 21 days avoids the late penalty${f ? ` ($${f.late})` : ''}. You can still appeal, but I won't invent reasons.`,
        'Con los datos disponibles, recomiendo pagar dentro del plazo. Si lo deseas, puedes continuar con una apelación.',
      ),
      grounds: [{ text_en: whyEn, fact_ids: factIds }],
    });
  };

  const account = fact('userAccount');
  if (input.kind === 'decision') {
    if (!account) return ask('account', '请用你自己的话说明为什么要申诉。', 'In your own words, why do you want to appeal?', 'text');
    return proposeAppeal(
      'OTHER',
      [{ text_en: `In my own words: ${account.note ?? account.value}`, fact_ids: [account.id] }],
      T(
        '好的，我只用你本人的陈述来写申诉。请先核对下面的事实，确认后我再写申诉信。',
        "OK — I'll use only your own statement. Please confirm the facts below first; I will write the statement after that.",
        'Usaré tu propia declaración. Primero revisa y confirma los datos.',
      ),
    );
  }

  const statement = input.kind === 'start' ? [account?.value, fact('voiceAccount')?.value].filter(Boolean).join('\n') : text;
  const visitor = personal.some((f) => f.key === 'outOfState' || f.key === 'firstVisit');
  if (awaiting === 'visitorEvidence' && input.kind === 'user' && text)
    await tool('record_fact', { key: 'visitorCheck', label: 'What happened at the parking space', value: text, provenance: 'USER_TEXT' });
  if (
    /\b(?:the (?:plate|vehicle) on (?:the|my) ticket (?:is wrong|is not mine)|(?:my|the) ticket (?:lists|shows|has) (?:a |the )?(?:wrong|different) (?:vehicle|plate))\b|车牌不符|不是我的车|la placa no es mía/i.test(
      statement,
    )
  ) {
    await tool('record_fact', { key: 'vehicleMatches', label: 'Vehicle on the citation', value: 'No — ' + statement, provenance: 'USER_TEXT' });
  }
  if (fact('vehicleMatches')?.value.startsWith('No') && fact('plateNumber'))
    return proposeAppeal(
      'VEHICLE_INFO',
      [{ text_en: 'I reported that the vehicle on the ticket does not match mine.', fact_ids: [fact('vehicleMatches')!.id, fact('plateNumber')!.id] }],
      T(
        '罚单上的车辆信息可能有误，请核对。',
        'Please review the reported discrepancy in the vehicle details.',
        'Revisa la discrepancia en los datos del vehículo.',
      ),
    );
  if (/\b(?:the sign was clear|I could clearly see the sign) when I parked\b|停车时路牌很清楚|la señal estaba clara cuando estacioné/i.test(statement))
    await tool('record_fact', { key: 'signClearAtIssue', label: 'Sign clearly visible when I parked', value: 'yes', provenance: 'USER_TEXT' });
  if (
    /\bI (?:received|got) (?:two|duplicate) (?:tickets|notices) for the same (?:incident|parking|event)\b|同一次停车.*收到两张罚单|recibí dos multas por el mismo/i.test(
      statement,
    )
  )
    await tool('record_fact', { key: 'duplicateReport', label: 'Reported duplicate tickets', value: statement, provenance: 'USER_TEXT' });
  const photos = c0.evidence.filter((e) => e.kind === 'evidence_photo' && !c0.fake.analyzed.includes(e.id));
  for (const photo of photos) {
    const kind = readDemoTruth(photo.path)?.kind;
    if (kind === 'sign' && (c0.violationType === 'RESIDENT_PERMIT' || c0.violationType === 'METER'))
      await tool('analyze_evidence', { evidence_id: photo.id, extract: 'sign_text' });
    if (kind === 'ticket' && fact('duplicateReport')) await tool('analyze_evidence', { evidence_id: photo.id, extract: 'duplicate_notice' });
  }
  async function offerOtherGround() {
    const vis = fact('signVisibility'),
      sign = fact('signText');
    if (vis && sign && ['partially_obscured', 'not_visible'].includes(vis.value)) {
      const clear = fact('signClearAtIssue');
      const description = clear
        ? 'The photo shows an obscured sign, although I recall that the sign was clear when I parked.'
        : 'The attached photo shows an obscured sign.';
      await proposeAppeal(
        'SIGNAGE',
        [
          {
            text_en: description + ' I ask that its visibility from the parking space be reviewed.',
            fact_ids: [vis.id, sign.id, ...(clear ? [clear.id] : [])],
          },
        ],
        T(
          '请核对照片和开单时的路牌可见度。',
          'Please review the evidence about the sign’s visibility.',
          'Revisa la evidencia sobre la visibilidad de la señal.',
        ),
      );
      return true;
    }
    const report = fact('duplicateReport'),
      duplicate = fact('duplicateNotice');
    if (report) {
      if (duplicate)
        await proposeAppeal(
          'OTHER',
          [
            {
              text_en: 'I received two notices for the same parking incident. Please compare this ticket with notice ' + duplicate.value + '.',
              fact_ids: [report.id, duplicate.id],
            },
          ],
          T(
            '两张罚单的车辆、时间、地点和违章事项相同，请核对。',
            'The two notices record the same vehicle, time, place and violation.',
            'Ambas multas indican el mismo vehículo, hora, lugar e infracción.',
          ),
        );
      else if (!photos.length && awaiting !== 'duplicateNotice')
        await ask(
          'duplicateNotice',
          c0.lang === 'zh'
            ? '可以上传另一张罚单吗？我会核对两个编号及当天的记录。'
            : c0.lang === 'es'
              ? '¿Puedes subir la otra multa para comparar los números y los datos?'
              : 'Can you upload the other notice so I can compare both numbers and records?',
          'Can you upload the other notice so I can compare both numbers and records?',
          'photo',
        );
      else return false;
      return true;
    }
    return false;
  }
  async function visitorQuestion() {
    const en = 'Was the sign unclear, was the street unmarked, or did the parking app fail? You can add a photo or receipt, or say none.';
    return ask(
      'visitorEvidence',
      c0.lang === 'zh'
        ? '路牌是否看不清、路口是否缺少标志，或者付款 App 是否出错？可以补照片或收据，也可以说没有。'
        : c0.lang === 'es'
          ? '¿La señal era poco clara, faltaba señalización o falló la aplicación de pago? Puedes aportar una foto o recibo, o decir que no.'
          : en,
      en,
      'photo',
    );
  }
  if (c0.violationType !== 'METER' && (await offerOtherGround())) return;
  const noPaymentEvidence =
    /no (?:receipt|evidence)|without a receipt|did not pay|didn.t pay|没(?:有)?(?:收据|凭证|付款)|未付款|sin recibo|no pagué|^no\b/i.test(
      [account?.value, statement].filter(Boolean).join('\n'),
    );
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
          T(
            '好消息：罚单开在计时器免费的时段（周日/市政假日），按官方规则可以申诉。请先核对下面的事实，确认后我再写申诉信。',
            'Good news: the ticket was issued when meters are free, so the official rule supports an appeal. Please confirm the facts below first; I will write the statement after that.',
            'La multa se emitió en un horario gratuito. Confirma los datos antes de redactar la carta.',
          ),
        );
      }
      const photo = ctx.store.must(caseId).evidence.find((e) => e.kind === 'evidence_photo' && !ctx.store.must(caseId).fake.analyzed.includes(e.id));
      if (photo) await tool('analyze_evidence', { evidence_id: photo.id, extract: 'paid_until' });
      if (fact('paidUntil')) {
        const cover = (await tool('check_rule', { rule: 'receipt_covers_ticket' })).result as { result: unknown; factId: string; detail: string };
        if (cover.result === true)
          return proposeAppeal(
            'PAID',
            [{ text_en: `I paid for parking. ${cover.detail}.`, fact_ids: [cover.factId, fact('paidUntil')?.id, issued?.id].filter(Boolean) as string[] }],
            T(
              '付款记录覆盖了罚单时间，申诉理由成立。请先核对下面的事实，确认后我再写申诉信。',
              'Your receipt covers the ticket time. Please confirm the facts below first; I will write the statement after that.',
              'El recibo cubre la hora de la multa. Confirma los datos antes de redactar la carta.',
            ),
          );
        if (await offerOtherGround()) return;
        return proposePay('付款有效期没有覆盖罚单开具时间', 'the payment period does not cover the time the ticket was issued', [cover.factId]);
      }
      if (await offerOtherGround()) return;
      if (visitor && !fact('visitorCheck')) return visitorQuestion();
      if (personal.length && (noPaymentEvidence || fact('visitorCheck'))) return requestDiscretion();
      if (input.kind === 'user' && /没付|没有付|didn.?t pay|did not pay|^no\b/i.test(text))
        return proposePay('当时没有付费，且不在免费时段', 'parking was not paid and meters were in effect', [hours.factId]);
      return ask(
        'paid',
        '你当时付过停车费吗？如果是用 ParkBoston 付的，请上传付款记录截图。',
        'Did you pay? If you used ParkBoston, please upload a screenshot of the payment.',
        'photo',
      );
    }
    case 'HYDRANT': {
      if (visitor && !fact('visitorCheck')) return visitorQuestion();
      if (awaiting === 'vehicleMatch' && input.kind === 'user') {
        if (/^(?:不一致|不对|不是我的车|不匹配|no[.!。]?$|no, (?:they|it) (?:do|does) not match|wrong (?:plate|vehicle)|no coincide)/i.test(text.trim())) {
          await tool('record_fact', {
            key: 'vehicleMatches',
            label: 'Vehicle details on ticket match my car',
            value: 'No — the ticket shows a different vehicle',
            provenance: 'USER_TEXT',
          });
          const vm = fact('vehicleMatches');
          return proposeAppeal(
            'VEHICLE_INFO',
            [{ text_en: 'The vehicle details recorded on this ticket do not match my vehicle.', fact_ids: [vm!.id, fact('plateNumber')!.id] }],
            T(
              '车辆信息不符可以作为申诉理由。请先核对下面的事实，确认后我再写申诉信。',
              'A vehicle mismatch is a valid ground. Please confirm the facts below first; I will write the statement after that.',
              'Los datos del vehículo difieren. Confirma los datos antes de redactar la carta.',
            ),
          );
        }
        if (/^(?:一致|匹配|是的|yes\b|they match\b|sí(?:\s|[.!]|$)|coinciden\b)/iu.test(text.trim()))
          await tool('record_fact', { key: 'vehicleMatches', label: 'Vehicle details on ticket match my car', value: 'Yes', provenance: 'USER_TEXT' });
      }
      if (fact('vehicleMatches')?.value === 'Yes') {
        const fine = (await tool('check_rule', { rule: 'fine_amount' })).result as { factId: string };
        return proposePay('消防栓前停车没有豁免，且罚单车辆信息与你的车一致', 'parking at a hydrant has no exemption and the vehicle details are correct', [
          fine.factId,
        ]);
      }
      return ask(
        'vehicleMatch',
        '罚单上的车牌和车型跟你的车一致吗？',
        'Do the plate and vehicle on the ticket match your car?',
        'choice',
        zh ? ['一致', '不一致'] : c0.lang === 'es' ? ['Sí', 'No'] : ['Yes', 'No'],
      );
    }
    case 'RESIDENT_PERMIT': {
      if (visitor && !fact('visitorCheck')) return visitorQuestion();
      if (personal.length && (fact('visitorCheck') || (awaiting === 'sign' && text) || /no (?:other )?evidence|没有证据|sin pruebas/i.test(statement)))
        return requestDiscretion();
      const vis = fact('signVisibility');
      if (vis?.value === 'clear') return proposePay('照片中的路牌清晰可见', 'the sign is clearly visible in the photo', [vis.id]);
      return ask('sign', '现场的 Resident Permit 路牌清楚吗？请拍一张路牌照片。', 'Was the resident-permit sign clear? Please upload a photo of it.', 'photo');
    }
    default: {
      if (visitor && !fact('visitorCheck')) return visitorQuestion();
      if (personal.length) return requestDiscretion();
      if (account)
        return proposeAppeal(
          'OTHER',
          [{ text_en: `In my own words: ${account.note ?? account.value}`, fact_ids: [account.id] }],
          T(
            '我会根据你的陈述来写申诉。请先核对下面的事实，确认后我再写申诉信。',
            'I will base the appeal on your statement. Please confirm the facts below first; I will write the statement after that.',
            'Basaré la carta en lo que has contado. Confirma los datos antes de continuar.',
          ),
        );
      return ask('account', '请简单描述当时的情况。', 'Please briefly describe what happened.', 'text');
    }
  }
}
