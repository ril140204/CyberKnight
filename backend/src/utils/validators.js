const { body } = require('express-validator');

// Danh sách các mật khẩu thông dụng bị cấm
const COMMON_PASSWORDS = [
  '12345678', '123456789', '1234567890', 'password', 'matkhau',
  'qwerty123', 'admin123', 'matkhau123', 'cyberknight', 'sigmabloom',
  'iloveyou', '00000000', '11111111', 'abc12345', 'pass1234'
];

/**
 * Validator cho Đăng ký tài khoản
 */
const registerValidation = [
  body('firstName')
    .trim()
    .notEmpty().withMessage('Vui lòng nhập họ của bạn')
    .isLength({ min: 1, max: 100 }).withMessage('Họ không được quá 100 ký tự')
    .custom((val) => {
      if (/[<>]/.test(val)) {
        throw new Error('Họ không được chứa ký tự < hoặc >');
      }
      if (/[\x00-\x1F\x7F]/.test(val)) {
        throw new Error('Họ không được chứa ký tự điều khiển');
      }
      return true;
    }),

  body('lastName')
    .trim()
    .notEmpty().withMessage('Vui lòng nhập tên của bạn')
    .isLength({ min: 1, max: 100 }).withMessage('Tên không được quá 100 ký tự')
    .custom((val) => {
      if (/[<>]/.test(val)) {
        throw new Error('Tên không được chứa ký tự < hoặc >');
      }
      if (/[\x00-\x1F\x7F]/.test(val)) {
        throw new Error('Tên không được chứa ký tự điều khiển');
      }
      return true;
    }),

  body('username')
    .trim()
    .notEmpty().withMessage('Vui lòng nhập tên đăng nhập')
    .isLength({ min: 3, max: 30 }).withMessage('Tên đăng nhập phải từ 3 đến 30 ký tự')
    .matches(/^[A-Za-z0-9_.-]{3,30}$/)
    .withMessage('Tên đăng nhập chỉ gồm chữ, số, dấu gạch dưới, gạch ngang hoặc dấu chấm (3-30 ký tự)'),

  // Bỏ normalizeEmail(), chỉ trim() và toLowerCase()
  body('email')
    .trim()
    .toLowerCase()
    .notEmpty().withMessage('Vui lòng nhập email')
    .isLength({ max: 255 }).withMessage('Email không được quá 255 ký tự')
    .isEmail().withMessage('Email không hợp lệ'),

  // BUG 12 FIX: Mật khẩu >= 8 ký tự, ít nhất 1 chữ và 1 số, không nằm trong danh sách cấm
  body('password')
    .isLength({ min: 8 }).withMessage('Mật khẩu cần ít nhất 8 ký tự, gồm cả chữ và số')
    .matches(/^(?=.*[a-zA-Z])(?=.*\d)/).withMessage('Mật khẩu cần ít nhất 8 ký tự, gồm cả chữ và số')
    .custom((val) => {
      if (COMMON_PASSWORDS.includes(val.toLowerCase())) {
        throw new Error('Mật khẩu này quá phổ biến và dễ đoán. Hãy chọn mật khẩu khác an toàn hơn nhé!');
      }
      return true;
    }),

  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Mật khẩu nhập lại không khớp');
      }
      return true;
    }),

  body('birthYear')
    .notEmpty().withMessage('Vui lòng chọn năm sinh')
    .isInt({
      min: new Date().getFullYear() - 100,
      max: new Date().getFullYear() - 5
    }).withMessage('Năm sinh không hợp lệ')
];

/**
 * Validator cho Đăng nhập
 */
const loginValidation = [
  body('emailOrUsername')
    .trim()
    .toLowerCase()
    .notEmpty().withMessage('Vui lòng nhập email hoặc tên đăng nhập'),

  body('password')
    .notEmpty().withMessage('Vui lòng nhập mật khẩu')
];

/**
 * Validator cho Quên mật khẩu
 */
const forgotPasswordValidation = [
  body('email')
    .trim()
    .toLowerCase()
    .notEmpty().withMessage('Vui lòng nhập email')
    .isEmail().withMessage('Email không hợp lệ')
];

/**
 * Validator cho Đặt lại mật khẩu
 */
const resetPasswordValidation = [
  body('token')
    .notEmpty().withMessage('Thiếu token đặt lại mật khẩu'),

  body('password')
    .isLength({ min: 8 }).withMessage('Mật khẩu cần ít nhất 8 ký tự, gồm cả chữ và số')
    .matches(/^(?=.*[a-zA-Z])(?=.*\d)/).withMessage('Mật khẩu cần ít nhất 8 ký tự, gồm cả chữ và số')
    .custom((val) => {
      if (COMMON_PASSWORDS.includes(val.toLowerCase())) {
        throw new Error('Mật khẩu này quá phổ biến. Hãy chọn mật khẩu khác!');
      }
      return true;
    }),

  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Mật khẩu nhập lại không khớp');
      }
      return true;
    })
];

/**
 * Validator cho Đổi mật khẩu khi đã đăng nhập (Admin / Change Password)
 * Yêu cầu: ≥ 12 ký tự, đủ uppercase + lowercase + digit + symbol
 */
const changePasswordValidation = [
  body('currentPassword')
    .notEmpty().withMessage('Vui lòng nhập mật khẩu hiện tại'),

  body('newPassword')
    .isLength({ min: 12 }).withMessage('Mật khẩu mới cần ít nhất 12 ký tự')
    .matches(/[A-Z]/).withMessage('Mật khẩu mới phải chứa ít nhất 1 chữ HOA')
    .matches(/[a-z]/).withMessage('Mật khẩu mới phải chứa ít nhất 1 chữ thường')
    .matches(/\d/).withMessage('Mật khẩu mới phải chứa ít nhất 1 chữ số')
    .matches(/[!@#$%^&*(),.?":{}|<>]/).withMessage('Mật khẩu mới phải chứa ít nhất 1 ký tự đặc biệt')
    .custom((val, { req }) => {
      if (val === req.body.currentPassword) {
        throw new Error('Mật khẩu mới không được trùng với mật khẩu hiện tại');
      }
      if (COMMON_PASSWORDS.includes(val.toLowerCase())) {
        throw new Error('Mật khẩu này quá phổ biến. Hãy chọn mật khẩu khác an toàn hơn!');
      }
      return true;
    }),
];

module.exports = {
  registerValidation,
  loginValidation,
  forgotPasswordValidation,
  resetPasswordValidation,
  changePasswordValidation,
};
