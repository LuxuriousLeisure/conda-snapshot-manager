const path = require('path');
const express = require('express');
const app = express();
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const session = require('express-session');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');

const GitHubStrategy = require('passport-github2').Strategy;

// 新增：加载环境变量（本地开发用 .env，Vercel 用控制台配置）
require('dotenv').config();

const MongoStore = require('connect-mongo');

// 导入模型
const User = require('./models/user');
const Snapshot = require('./models/snapshot');

// 配置视图引擎
const viewsPath = path.join(__dirname, 'views');
app.set('view engine', 'ejs');
app.set('views', viewsPath); 

// 静态文件目录
app.use(express.static('public'));

// 中间件配置
app.use(bodyParser.json()); 
app.use(bodyParser.urlencoded({ extended: true })); 
app.use(session({
    // secret: "CondaSnapshotSecret",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ 
      mongoUrl: process.env.MONGODB_URI,
      ttl: 14 * 24 * 60 * 60 // 14 天
    }),
    cookie:{
      secure: process.env.NODE_ENV === 'production', // 生产环境使用 secure cookies
    }
}));

// Passport 配置
app.use(passport.initialize());
app.use(passport.session());

// 本地策略配置
passport.use(new LocalStrategy(
  async (username, password, done) => {
    try {
      const user = await User.findOne({ username: username });
      if (!user) {
        return done(null, false, { message: '用户名不存在' });
      }
      const isValid = await user.isValidPassword(password);
      if (!isValid) {
        return done(null, false, { message: '密码错误' });
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

//Github OAuth
passport.use(new GitHubStrategy({
    // clientID: "Ov23liw2Bken2CAnHOS5",
    // clientSecret: "8df49b948c0b9cd09b6ddd464dced69f58e4a850",  
    // callbackURL: "http://localhost:3000/auth/github/callback"
    clientID: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL: process.env.GITHUB_CALLBACK_URL
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      // 检查用户是否已存在
      let user = await User.findOne({ githubId: profile.id });
      
      if (user) {
        // 用户已存在，直接返回
        return done(null, user);
      } else {
        // 创建新用户
        const newUser = new User({
          username: profile.username,
          password: Math.random().toString(36).substring(2),  // 随机密码，因为GitHub登录不需要密码
          githubId: profile.id  // 添加githubId字段
        });
        
        await newUser.save();
        return done(null, newUser);
      }
    } catch (err) {
      return done(err);
    }
  }
));

// 添加GitHub OAuth路由
app.get('/auth/github',
  passport.authenticate('github', { scope: ['user:email'] })
);

app.get('/auth/github/callback',
  passport.authenticate('github', { failureRedirect: '/login' }),
  (req, res) => {
    // 认证成功，重定向到主页
    res.redirect('/view');
  }
);

// 请求日志中间件
app.use((req, res, next) => {
  console.log(`Received request for: ${req.originalUrl} from ${req.user ? req.user.username : '未登录用户'}`);
  next();
});

// 登录验证中间件
const isLoggedIn = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.redirect('/login');
};

// MongoDB 连接
// const mongourl = 'mongodb+srv://wuyou007991:007991@cluster0.ashcnqc.mongodb.net/?appName=Cluster0';
// const dbName = 'CondaSnapshots';
const mongourl = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'CondaSnapshots';

mongoose.connect(mongourl, { dbName: dbName })
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// 解析conda list文本为对象数组
const parseCondaList = (text) => {
  const lines = text.trim().split('\n');
  const packages = [];
  
  for (const line of lines) {
    // 跳过注释行
    if (line.startsWith('#')) continue;
    
    // 分割列（处理多个空格）
    const parts = line.trim().split(/\s+/);
    
    if (parts.length >= 2) {
      packages.push({
        name: parts[0],
        version: parts[1],
        build: parts[2] || '',
        channel: parts[3] || ''
      });
    }
  }
  
  return packages;
};

// 路由配置

// 首页/登录页
app.get("/", (req, res) => {
  res.redirect('/login');
});

app.get("/login", (req, res) => {
  res.render('login', { message: null }); 
});

app.post("/login", 
  passport.authenticate('local', { 
    successRedirect: '/view', 
    failureRedirect: '/login',
    failureFlash: true
  })
);

// 注册功能（可选）
app.get("/register", (req, res) => {
  res.render('register', { message: null });
});

app.post("/register", async (req, res) => {
  try {
    const existingUser = await User.findOne({ username: req.body.username });
    if (existingUser) {
      return res.render('register', { message: '用户名已存在' });
    }
    
    const newUser = new User({
      username: req.body.username,
      password: req.body.password
    });
    
    await newUser.save();
    res.redirect('/login');
  } catch (err) {
    res.render('register', { message: '注册失败，请重试' });
  }
});

// 登出
app.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect('/login');
  });
});

// 查看所有快照
const findAllSnapshots = async (userId) => {
  return await Snapshot.find({ createdBy: userId }).sort({ createdAt: -1 });
};

const handle_FindAll = async (req, res) => {
  try {
    const snapshots = await findAllSnapshots(req.user._id);
    res.render('history', { 
      nSnapshots: snapshots.length, 
      snapshots: snapshots,
      user: req.user 
    });
  } catch (error) {
    console.error("Error fetching snapshots:", error);
    res.status(500).render('info', { message: '获取快照失败', user: req.user });
  }
};

app.get('/history', isLoggedIn, handle_FindAll);

// 按条件查询快照
const findSnapshotsByCriteria = async (userId, criteria) => {
  // 构建查询条件，始终包含用户ID
  const query = { createdBy: userId };
  
  if (criteria.environmentName) {
    query.environmentName = new RegExp(criteria.environmentName, 'i');
  }
  
  if (criteria.environmentType && criteria.environmentType !== 'all') {
    query.environmentType = criteria.environmentType;
  }
  
  if (criteria.packageName) {
    query['packages.name'] = new RegExp(criteria.packageName, 'i');
  }
  
  return await Snapshot.find(query).sort({ createdAt: -1 });
};

// const handle_FindOne = async (req, res) => {
//   try {
//     const criteria = {
//       environmentName: req.body.environmentName,
//       environmentType: req.body.environmentType,
//       packageName: req.body.packageName
//     };
    
//     const foundSnapshots = await findSnapshotsByCriteria(req.user._id, criteria);
    
//     if (foundSnapshots.length > 0) {
//       res.render('view1', { 
//         snapshots: foundSnapshots,
//         user: req.user 
//       });
//     } else {
//       res.render('view1', { 
//         snapshots: [],
//         message: '没有找到符合条件的快照',
//         user: req.user 
//       });
//     }
//   } catch (error) {
//     console.error("Error searching snapshots:", error);
//     res.status(500).render('info', { message: '搜索快照失败', user: req.user });
//   }
// };
const handle_FindOne = async (req, res) => {
  try {
    const criteria = {
      environmentName: req.body.environmentName,
      environmentType: req.body.environmentType,
      packageName: req.body.packageName
    };
    
    const foundSnapshots = await findSnapshotsByCriteria(req.user._id, criteria);
    
    if (foundSnapshots.length > 0) {
      // 有结果时，message设为null（或空字符串）
      res.render('view1', { 
        snapshots: foundSnapshots,
        message: null,  // 关键：始终传递message
        user: req.user 
      });
    } else {
      res.render('view1', { 
        snapshots: [],
        message: '没有找到符合条件的快照',
        user: req.user 
      });
    }
  } catch (error) {
    console.error("Error searching snapshots:", error);
    res.status(500).render('info', { message: '搜索快照失败', user: req.user });
  }
};

app.get('/view', isLoggedIn, (req, res) => {
  res.render('view', { user: req.user });
});

app.post('/view', isLoggedIn, handle_FindOne);

// 获取快照详情（用于更新）
const getSnapshotById = async (userId, snapshotId) => {
  return await Snapshot.findOne({ 
    _id: snapshotId,
    createdBy: userId
  });
};

app.get('/update/:id', isLoggedIn, async (req, res) => {
  try {
    const snapshot = await getSnapshotById(req.user._id, req.params.id);
    
    if (snapshot) {
      res.render('view_update', { 
        snapshot: snapshot,
        user: req.user 
      });
    } else {
      res.status(404).render('info', { message: '快照不存在', user: req.user });
    }
  } catch (error) {
    console.error("Error fetching snapshot for update:", error);
    res.status(500).render('info', { message: '获取快照失败', user: req.user });
  }
});

// 更新快照
const updateSnapshot = async (userId, snapshotId, updateData) => {
  // 如果更新了原始文本，重新解析包信息
  if (updateData.rawText) {
    updateData.packages = parseCondaList(updateData.rawText);
  }
  
  return await Snapshot.findOneAndUpdate(
    { _id: snapshotId, createdBy: userId },
    { $set: updateData },
    { new: true, runValidators: true }
  );
};

app.post('/update/:id', isLoggedIn, async (req, res) => {
  try {
    const updateData = {
      environmentName: req.body.environmentName,
      environmentType: req.body.environmentType,
      description: req.body.description,
      rawText: req.body.rawText
    };
    
    const updatedSnapshot = await updateSnapshot(
      req.user._id, 
      req.params.id, 
      updateData
    );
    
    if (updatedSnapshot) {
      res.render('info', { 
        message: '快照已成功更新', 
        user: req.user 
      });
    } else {
      res.status(404).render('info', { message: '更新失败，快照不存在', user: req.user });
    }
  } catch (error) {
    console.error("Error updating snapshot:", error);
    res.status(500).render('info', { message: '更新快照失败', user: req.user });
  }
});

// 删除快照
const deleteSnapshot = async (userId, snapshotId) => {
  return await Snapshot.deleteOne({
    _id: snapshotId,
    createdBy: userId
  });
};

app.post('/delete', isLoggedIn, async (req, res) => {
  try {
    const result = await deleteSnapshot(req.user._id, req.body._id);
    
    if (result.deletedCount > 0) {
      res.redirect('/history');
    } else {
      res.status(404).render('info', { message: '删除失败，快照不存在', user: req.user });
    }
  } catch (error) {
    console.error("Error deleting snapshot:", error);
    res.status(500).render('info', { message: '删除快照失败', user: req.user });
  }
});

// 创建快照页面
app.get('/report', isLoggedIn, (req, res) => {
  res.render('report', { user: req.user });
});

// 创建快照
const createSnapshot = async (snapshotData) => {
  // 解析原始文本为包数组
  const packages = parseCondaList(snapshotData.rawText);
  
  const newSnapshot = new Snapshot({
    ...snapshotData,
    packages: packages
  });
  
  return await newSnapshot.save();
};

app.post('/report', isLoggedIn, async (req, res) => {
  try {
    const snapshotData = {
      environmentName: req.body.environmentName,
      environmentType: req.body.environmentType,
      rawText: req.body.rawText,
      description: req.body.description,
      createdBy: req.user._id
    };
    
    await createSnapshot(snapshotData);
    res.render('info', { 
      message: '快照已成功创建', 
      user: req.user 
    });
  } catch (error) {
    console.error("Error creating snapshot:", error);
    res.status(500).render('info', { message: '创建快照失败', user: req.user });
  }
});

// RESTful API 接口
// 获取所有快照
app.get('/api/snapshots', isLoggedIn, async (req, res) => {
  try {
    const snapshots = await findAllSnapshots(req.user._id);
    res.json(snapshots);
  } catch (error) {
    res.status(500).json({ error: '获取快照失败' });
  }
});

// 获取特定快照
app.get('/api/snapshots/:id', isLoggedIn, async (req, res) => {
  try {
    const snapshot = await getSnapshotById(req.user._id, req.params.id);
    if (snapshot) {
      res.json(snapshot);
    } else {
      res.status(404).json({ error: '快照不存在' });
    }
  } catch (error) {
    res.status(500).json({ error: '获取快照失败' });
  }
});

// 创建快照
app.post('/api/snapshots', isLoggedIn, async (req, res) => {
  try {
    const snapshotData = {
      ...req.body,
      createdBy: req.user._id
    };
    
    const newSnapshot = await createSnapshot(snapshotData);
    res.status(201).json(newSnapshot);
  } catch (error) {
    res.status(500).json({ error: '创建快照失败' });
  }
});

// 更新快照
app.put('/api/snapshots/:id', isLoggedIn, async (req, res) => {
  try {
    const updatedSnapshot = await updateSnapshot(
      req.user._id, 
      req.params.id, 
      req.body
    );
    
    if (updatedSnapshot) {
      res.json(updatedSnapshot);
    } else {
      res.status(404).json({ error: '快照不存在' });
    }
  } catch (error) {
    res.status(500).json({ error: '更新快照失败' });
  }
});

// 删除快照
app.delete('/api/snapshots/:id', isLoggedIn, async (req, res) => {
  try {
    const result = await deleteSnapshot(req.user._id, req.params.id);
    
    if (result.deletedCount > 0) {
      res.json({ message: '快照已删除' });
    } else {
      res.status(404).json({ error: '快照不存在' });
    }
  } catch (error) {
    res.status(500).json({ error: '删除快照失败' });
  }
});

// 404 处理
app.use((req, res) => {
  res.status(404).render('info', { 
    message: '页面不存在', 
    user: req.user 
  });
});

// 启动服务器
// const port = process.env.PORT || 3000;
// app.listen(port, () => {
//   console.log(`Server running on http://localhost:${port}`);
// });
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);

});
