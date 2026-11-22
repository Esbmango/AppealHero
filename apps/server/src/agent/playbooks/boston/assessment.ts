import type { DisputeReason, Ground, Triage } from '@appealhero/shared';
import type { CaseRecord } from '../../../core/types';
import { personalFacts } from '../../runtime/circumstances';
import { latestFact } from '../../policy/facts';
import { fineFor, runRule } from '../../rules/boston';
import { words } from './common';
import { matchPlaybook, playbookContext, supportedDefense } from '..';

const explanation = {
  STRONG: words(
    'A verified rule or matching documentation directly supports this ground.',
    '已核实的规则或相符的凭证直接支持这项理由。',
    'Una regla verificada o documentación coincidente respalda directamente este motivo.',
  ),
  MODERATE: words(
    'There is a specific ground. The reviewer must weigh the account or interpret the evidence.',
    '有具体的申诉理由，审核人员还需判断陈述或证据。',
    'Hay un motivo concreto. La persona que revise el caso deberá valorar la declaración o las pruebas.',
  ),
  WEAK: words(
    'Your circumstances support a request for discretion. The city decides. We found no official Boston hardship-reduction policy. For payment options call the Parking Clerk at 617-635-4410.',
    '可以根据你的个人情况请求酌情处理，结果由市方决定。我们未找到波士顿官方的经济困难减免政策。缴费选项可致电停车事务处 617-635-4410。',
    'Puedes pedir consideración por tus circunstancias. La ciudad decide. No encontramos una política oficial de Boston de reducción por dificultades económicas. Para opciones de pago llama al 617-635-4410.',
  ),
  NONE: words(
    'The facts supplied so far do not establish a ground to dispute the ticket.',
    '目前提供的事实尚未支持具体申诉理由。',
    'Los datos aportados hasta ahora no sustentan un motivo para impugnar la multa.',
  ),
};
const objections = {
  discretion: words('The restriction may still have applied at the time.', '当时的停车限制可能仍然有效。', 'Es posible que la restricción siguiera vigente.'),
  time: words(
    'The reviewer may check the exact time, vehicle and posted restriction.',
    '审核人员可能核对具体时间、车辆及现场标志。',
    'Podrían verificar la hora exacta, el vehículo y la restricción indicada.',
  ),
  photo: words(
    'A later photo may show different conditions from the ones at the time of the ticket.',
    '事后照片中的情况可能与开单时不同。',
    'Una foto posterior podría mostrar condiciones distintas a las de ese momento.',
  ),
};
const evidence = {
  sign: [
    words('Photo of the sign and parking space', '路牌与停车位置的合照', 'Foto de la señal y la plaza'),
    words(
      'Shows what the driver could see; note when the photo was taken.',
      '说明驾驶人能看到什么；请标注拍摄时间。',
      'Muestra qué podía ver el conductor; indica cuándo se tomó.',
    ),
  ],
  meter: [
    words('Meter photo or timed payment receipt', '计时器照片或带时间的付款凭证', 'Foto del parquímetro o recibo con hora'),
    words(
      'Connects the meter or payment interval to this plate and citation.',
      '把计时器或付款时段与车牌、罚单对应起来。',
      'Relaciona el parquímetro o intervalo pagado con la placa y la multa.',
    ),
  ],
  permit: [
    words('Permit and registration photo', '许可贴纸和车辆登记照片', 'Foto del permiso y del registro'),
    words('Shows the vehicle, neighborhood and permit validity.', '用于核对车辆、街区和许可有效性。', 'Permite comprobar el vehículo, la zona y la vigencia.'),
  ],
  hydrant: [
    words('Photo of the vehicle and hydrant together', '车辆与消防栓的合照', 'Foto del vehículo y del hidrante juntos'),
    words('Provides context for the estimated distance.', '为估算距离提供参照。', 'Aporta contexto para la distancia estimada.'),
  ],
  circumstance: [
    words('Available documentation of the event', '能说明当天情况的材料', 'Documentación disponible del incidente'),
    words(
      'A dated repair, medical or police record can corroborate the account; share only relevant details.',
      '带日期的维修、就医或报警记录可佐证陈述；只需提供有关内容。',
      'Un comprobante fechado de reparación, atención médica o denuncia puede respaldar tu versión; comparte solo lo pertinente.',
    ),
  ],
};
export function evidenceChecklist(c: CaseRecord) {
  const lang = c.lang === 'es' || c.lang === 'zh' ? c.lang : 'en';
  const relevant = [evidence.sign];
  if (c.violationType === 'METER') relevant.push(evidence.meter);
  if (c.violationType === 'RESIDENT_PERMIT') relevant.push(evidence.permit);
  if (c.violationType === 'HYDRANT') relevant.push(evidence.hydrant);
  if (personalFacts(c).some((f) => f.key === 'circumstance')) relevant.push(evidence.circumstance);
  return relevant.map(([what, why]) => ({ what: what[lang], why: why[lang] }));
}
export function assess(c: CaseRecord, recommendation: Triage['recommendation'], reason: DisputeReason | undefined, grounds: Ground[]) {
  const lang = c.lang === 'es' || c.lang === 'zh' ? c.lang : 'en';
  const personal = personalFacts(c);
  const book = matchPlaybook(c.ticket?.violation || c.violationType || '');
  const defense = recommendation === 'APPEAL' && reason && book ? supportedDefense(book, playbookContext(c), reason, grounds) : undefined;
  let strength: Triage['strength'] = 'NONE';
  let why = explanation.NONE[lang];
  if (defense) {
    const incompleteReceipt = reason === 'PAID' && !['receiptPlate', 'paidFrom'].every((k) => latestFact(c, k)?.provenance === 'PHOTO_EVIDENCE');
    const contradicted = defense.id === 'obscured_sign' && latestFact(c, 'signClearAtIssue')?.value === 'yes';
    strength = contradicted
      ? 'WEAK'
      : !incompleteReceipt && ['meter_hours', 'paid', 'displayed', 'outside_posted_hours'].includes(defense.id)
        ? 'STRONG'
        : 'MODERATE';
    const conflict = words(
      'You recall a clear sign when you parked; the photo shows it obscured.',
      '你记得停车时路牌清晰，照片里却有遮挡。',
      'Recuerdas una señal visible al estacionar, pero aparece tapada en la foto.',
    );
    why = defense.explain[lang] + ' ' + (contradicted ? conflict[lang] : explanation[strength][lang]);
  } else if (recommendation === 'APPEAL' && personal.length) {
    strength = 'WEAK';
    why = explanation.WEAK[lang];
  } else if (recommendation === 'APPEAL' && reason && reason !== 'OTHER') {
    strength = 'MODERATE';
    why = explanation.MODERATE[lang];
  }
  if (defense && personal.length) why += ' ' + explanation.WEAK[lang];
  const amount = latestFact(c, 'fineAmount')?.value;
  const f = fineFor(latestFact(c, 'violation')?.value, amount ? Number(amount) : undefined, c.violationType);
  const issued = latestFact(c, 'issuedAt')?.value;
  const deadline = issued && Number.isFinite(Date.parse(issued)) ? runRule('appeal_deadline', { issuedAt: issued }).result : undefined;
  return {
    strength,
    strengthWhy: why,
    considerations: personal.map((f) => f.id),
    rebuttals: [(strength === 'WEAK' && !defense ? objections.discretion : reason === 'SIGNAGE' ? objections.photo : objections.time)[lang]],
    evidenceToAdd: evidenceChecklist(c),
    fineAmount: f.fine,
    latePenalty: f.late,
    deadline: typeof deadline === 'string' ? deadline : undefined,
  };
}
