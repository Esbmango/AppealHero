import { definePlaybook } from '@appealhero/shared';
import { fines, pay, photo, platesMatch, postedHoursDefense, question, sameArea, signDefense, value, vehicleDefense, words } from './common';
export const permit = definePlaybook({
  id: 'boston.resident_permit',
  version: '1',
  title: words('Resident permit', '居民停车许可', 'Permiso de residente'),
  match: (v) => /resident|permit/i.test(v),
  autoRules: ['fine_amount', 'appeal_deadline'],
  fines: fines('RESIDENT PERMIT ONLY', 'NO VALID RESIDENT PARKING PERMIT/STICKER'),
  questions: [
    question(
      'permit',
      'choice',
      words('Did you have a permit for that neighborhood?', '当时有这个街区的停车许可吗？', '¿Tenías permiso para ese barrio?'),
      words('Permits apply to a specific neighborhood and vehicle.', '许可与街区和车辆相关。', 'El permiso corresponde a un barrio y vehículo.'),
      (c) => !value(c, 'permit'),
    ),
    question(
      'evidence',
      'photo',
      words('Can you show the permit or the posted sign?', '请上传许可贴纸或路牌照片。', '¿Puedes subir una foto del permiso o de la señal?'),
      words('We can compare the details visible in the photo.', '需要核对照片中可见的信息。', 'Podemos comparar los datos visibles.'),
      (c) => !value(c, 'signVisibility') && !value(c, 'permitPlate'),
    ),
    question(
      'photoContext',
      'text',
      words('Where and when did you take this photo?', '照片是什么时间、在什么位置拍的？', '¿Dónde y cuándo tomaste la foto?'),
      words('Sign visibility can change.', '路牌的可见度可能改变。', 'La visibilidad de la señal puede cambiar.'),
      (c) => photo(c, 'signVisibility') && !value(c, 'photoContext'),
    ),
  ],
  defenses: [
    vehicleDefense,
    signDefense,
    postedHoursDefense,
    {
      id: 'displayed',
      reason: 'PERMIT_DISPLAYED',
      basis: 'rule',
      verified: true,
      source: 'https://www.boston.gov/departments/parking-clerk/resident-parking-permits',
      needs: ['permitArea', 'signArea', 'permitPlate', 'plateNumber', 'permitDisplayed'],
      holds: (c) =>
        photo(c, 'permitArea') &&
        photo(c, 'signArea') &&
        photo(c, 'permitPlate') &&
        photo(c, 'permitDisplayed') &&
        sameArea(c, 'permitArea', 'signArea') &&
        platesMatch(c, 'permitPlate', 'plateNumber') &&
        value(c, 'permitDisplayed') === 'yes'
          ? 'yes'
          : 'no',
      explain: words('A matching permit was displayed.', '展示了与车辆和街区相符的许可。', 'Se exhibía un permiso del vehículo y barrio correctos.'),
      draftHint: 'Describe the visible sticker and match both the neighborhood and the plate.',
    },
  ],
  notes: [
    {
      when: (c) => /rent|租|alquil/i.test(value(c, 'permit') ?? ''),
      text: words(
        'For a rental, ask for the rental agreement and proof of residence. Eligibility after office hours requires individual review.',
        '租车时请提供租车合同和居住证明。办公时间外的适用条件需个别核实。',
        'Para un auto alquilado pide el contrato y prueba de residencia. La elegibilidad fuera de horario requiere revisión individual.',
      ),
    },
  ],
  recommendPay: pay(
    words(
      'No matching permit or sign evidence supports an appeal.',
      '没有相符的许可或路牌证据支持申诉。',
      'La información del permiso o señal no respalda la apelación.',
    ),
  ),
});
