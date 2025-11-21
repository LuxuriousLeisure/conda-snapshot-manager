const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  githubId: {
  type: String,
  unique: true,
  sparse: true  // 允许为null，因为不是所有用户都用GitHub登录
}
});

// // 密码加密
// userSchema.pre('save', async function(next) {
//   if (this.isNew || this.isModified('password')) {
//     this.password = await bcrypt.hash(this.password, 10);
//   }
//   next();
// });

// // 密码加密验证方法
// userSchema.methods.isValidPassword = async function(password) {
//   return await bcrypt.compare(password, this.password);
// };

// 明文密码验证方法（仅用于测试环境）
userSchema.methods.isValidPassword = async function(password) {
  return this.password === password; // 直接对比明文
};

module.exports = mongoose.model('User', userSchema);