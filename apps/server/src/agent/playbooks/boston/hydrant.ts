import { definePlaybook } from '@appealhero/shared';
import { fines, pay, question, trafficRules, value, words } from './common';
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
      (c) => !!value(c, 'vehicleMatches') && !value(c, 'distance'),
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
      id: 'different_vehicle',
      reason: 'VEHICLE_INFO',
      basis: 'statement',
      verified: true,
      needs: ['vehicleMatches', 'plateNumber'],
      holds: (c) => (/^(no\b|不一致|不匹配)/i.test(value(c, 'vehicleMatches') ?? '') ? 'yes' : 'no'),
      explain: words('The vehicle details do not match.', '罚单上的车辆信息不符。', 'Los datos del vehículo no coinciden.'),
      draftHint: 'Cite the discrepancy reported by the driver and the plate on the ticket.',
    },
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
