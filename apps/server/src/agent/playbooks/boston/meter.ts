import { definePlaybook } from '@appealhero/shared';
import { RULE_SOURCES } from '../../rules/boston';
import { fines, pay, photo, postedHoursDefense, question, trafficRules, words, value } from './common';
export const meter = definePlaybook({
  id: 'boston.meter',
  version: '1',
  title: words('Meter ticket', '计时器罚单', 'Multa de parquímetro'),
  match: (v) => /meter/i.test(v),
  fines: fines('METER FEE UNPAID', 'OVER METER LIMIT', 'METER VIOLATION (OUT OF ORDER)'),
  autoRules: ['meter_free_day', 'meter_hours_in_effect', 'fine_amount', 'appeal_deadline'],
  questions: [
    question(
      'payment',
      'choice',
      words(
        'How did you pay or was a placard displayed?',
        '你如何付款？当时是否展示了残障停车牌？',
        '¿Cómo pagaste o tenías un permiso de discapacidad a la vista?',
      ),
      words('This identifies what evidence to check.', '这决定需要核对哪种凭证。', 'Esto indica qué comprobante revisar.'),
      (c) => c.rules.get('meter_hours_in_effect')?.result !== false && !value(c, 'payment') && !value(c, 'paidUntil'),
    ),
    question(
      'receipt',
      'photo',
      words(
        'Can you upload your receipt or a photo of the displayed placard?',
        '请上传付款收据或展示残障停车牌的照片。',
        '¿Puedes subir el recibo o una foto del permiso de discapacidad a la vista?',
      ),
      words('We compare the payment period with the ticket time.', '需要核对付款时段与开票时间。', 'Comparamos el período pagado con la hora de la multa.'),
      (c) => !!value(c, 'payment') && !value(c, 'paidUntil') && c.rules.get('meter_hours_in_effect')?.result !== false,
      'paidUntil',
    ),
  ],
  defenses: [
    postedHoursDefense,
    {
      id: 'displayed_placard',
      reason: 'OTHER',
      basis: 'rule',
      verified: true,
      source: RULE_SOURCES.meterFreeDays,
      needs: ['placardDisplayed'],
      holds: (c) => (value(c, 'placardDisplayed') === 'yes' ? 'yes' : 'no'),
      explain: words(
        'The driver reports a displayed disability placard.',
        '驾驶人表示展示了残障停车牌。',
        'El conductor indica que exhibía un permiso de discapacidad.',
      ),
      draftHint: 'Use OTHER only after an explicit appeal-anyway choice. Describe what the driver confirmed.',
    },
    {
      id: 'meter_hours',
      reason: 'METER_NOT_IN_EFFECT',
      basis: 'rule',
      verified: true,
      source: RULE_SOURCES.meterHours,
      needs: ['issuedAt', 'rule:meter_hours_in_effect'],
      holds: (c) =>
        c.rules.get('meter_hours_in_effect')?.result === false && !/out of order|not in metered space/i.test(c.ticket?.violation ?? '') ? 'yes' : 'no',
      explain: words('Meter hours were not in effect.', '开票时不在计时器收费时段。', 'El parquímetro no cobraba a esa hora.'),
      draftHint: 'Cite the issue time and the verified hours check.',
    },
    {
      id: 'paid',
      reason: 'PAID',
      basis: 'evidence',
      verified: true,
      needs: ['issuedAt', 'paidUntil', 'rule:receipt_covers_ticket'],
      holds: (c) =>
        photo(c, 'paidUntil') &&
        c.rules.get('receipt_covers_ticket')?.result === true &&
        (!value(c, 'receiptPlate') || value(c, 'receiptPlate') === value(c, 'plateNumber')) &&
        /fee unpaid/i.test(c.ticket?.violation ?? '')
          ? 'yes'
          : 'no',
      explain: words('The receipt covers the ticket time.', '收据覆盖开票时间。', 'El recibo cubre la hora de la multa.'),
      draftHint: 'Compare the times printed on the receipt and the ticket.',
    },
  ],
  notes: [
    {
      when: () => true,
      text: words(
        'A broken meter alone does not excuse parking. Free meter hours apply only to meter charges. See ' + trafficRules + ' (Art. IV §4–5).',
        '计时器故障本身不是豁免理由。免费时段只适用于计时器收费。',
        'Un parquímetro averiado por sí solo no exime del pago. El horario gratuito solo afecta al cobro del parquímetro.',
      ),
    },
  ],
  recommendPay: pay(words('Payment evidence does not cover the ticket time.', '付款凭证未覆盖开票时间。', 'El comprobante no cubre la hora de la multa.')),
});
