import { definePlaybook } from '@appealhero/shared';
import { fines, pay, question, trafficRules, value, vehicleDefense, words } from './common';
export const hydrant = definePlaybook({
  id: 'boston.hydrant',
  version: '1',
  title: words('Fire hydrant', '消防栓', 'Hidrante'),
  match: (v) => /hydrant/i.test(v),
  autoRules: ['fine_amount', 'appeal_deadline'],
  fines: fines('HYDRANT'),
  questions: [
    question(
      'vehicleMatches',
      'choice',
      words(
        'Do the plate and vehicle on the ticket match yours?',
        '罚单上的车辆和车牌与你的一致吗？',
        '¿Coinciden el vehículo y la placa de la multa con los tuyos?',
      ),
      words('A vehicle mismatch can be documented.', '车辆信息不符时可以提供依据。', 'Una discrepancia se puede documentar.'),
      (c) => !value(c, 'vehicleMatches'),
    ),
    question(
      'distance',
      'choice',
      words('About how far away was the hydrant?', '停车位置离消防栓大约多远？', '¿A qué distancia estaba el hidrante?'),
      words('A photo alone cannot establish exact distance.', '仅凭照片不能确定准确距离。', 'Una foto sola no establece la distancia exacta.'),
      (c) => /^(yes|一致|sí|si)/iu.test(value(c, 'vehicleMatches') ?? '') && !value(c, 'distance'),
    ),
    question(
      'distancePhoto',
      'photo',
      words('Can you show both the vehicle and the hydrant?', '请上传同时显示车辆与消防栓的照片。', '¿Puedes mostrar el vehículo y el hidrante juntos?'),
      words('This provides context for your estimate.', '照片可辅助说明你的距离估计。', 'La foto ayuda a contextualizar tu estimación.'),
      (c) => value(c, 'distance') === 'over_10_ft' && !c.evidence.some((e) => e.kind === 'evidence_photo'),
    ),
  ],
  defenses: [
    {
      id: 'reported_distance',
      reason: 'OTHER',
      basis: 'statement',
      verified: true,
      source: trafficRules,
      needs: ['distance', 'hydrantPhoto'],
      holds: (c) => (value(c, 'distance') === 'over_10_ft' && c.facts.get('hydrantPhoto')?.provenance === 'PHOTO_EVIDENCE' ? 'yes' : 'no'),
      explain: words(
        'The driver estimates more than ten feet and supplied a photo.',
        '驾驶人估计距离超过十英尺，并附有照片。',
        'El conductor estima más de diez pies y aportó una foto.',
      ),
      draftHint:
        'Record the driver’s estimate as distance=over_10_ft and use analyze_evidence hydrant_context. A photo does not measure distance. OTHER requires the driver to choose appeal anyway.',
    },
    vehicleDefense,
  ],
  notes: [
    {
      when: () => true,
      text: words(
        'If the vehicle matches, record any distance estimate as the driver’s account. For the 10-foot rule see ' +
          trafficRules +
          ' (Art. IV §1(6)). An OTHER appeal needs the driver’s explicit choice.',
        '车辆一致时，距离估计只能作为用户陈述；使用其他理由需用户明确选择。',
        'Si el vehículo coincide, atribuye cualquier estimación al conductor. El motivo OTRO requiere su decisión expresa.',
      ),
    },
  ],
  recommendPay: pay(
    words(
      'Vehicle details match and there is no evidence of a discrepancy.',
      '车辆信息一致，未发现支持异议的证据。',
      'El vehículo coincide y no hay pruebas de una discrepancia.',
    ),
  ),
});
