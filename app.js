const express = require('express')
const path = require('path')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const app = express()
app.use(express.json())

const dbPath = path.join(__dirname, 'twitterClone.db')

let db = null

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server Running at http://localhost:3000/')
    })
  } catch (e) {
    console.log(`DB Error: ${e.message}`)
    process.exit(1)
  }
}

initializeDbAndServer()

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const hasePassword = await bcrypt.hash(password, 10)
  const selectUserQuery = `SELECT * FROM user WHERE username ='${username}';`
  const dbuser = await db.get(selectUserQuery)

  if (password.length < 6) {
    response.status(400)
    response.send('Password is too short')
  } else {
    if (dbuser === undefined) {
      const createUserQuery = `INSERT INTO
          user (username, name, password, gender)
        VALUES
          (
            '${username}',
            '${name}',
            '${hasePassword}',
            '${gender}'
          )`
      const userCreated = await db.run(createUserQuery)
      response.status(200)
      response.send('User created successfully')
    } else {
      response.status(400)
      response.send('User already exists')
    }
  }
})

app.post('/login', async (request, response) => {
  const {username, password} = request.body
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`
  const dbUser = await db.get(selectUserQuery)
  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      }
      const jwtToken = jwt.sign(payload, 'MY_SECRET_TOKEN')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

const authenticate = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'MY_SECRET_TOKEN', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username

        next()
      }
    })
  }
}

app.get('/user/tweets/feed/', authenticate, async (request, response) => {
  let {username} = request

  const getUserId = `SELECT * FROM user WHERE username ='${username}';`
  const userId = await db.get(getUserId)
  const {user_id} = userId

  const getTweetsQuery = `
    SELECT 
      username,
      tweet,
      date_time AS dateTime
    FROM 
      follower INNER JOIN tweet ON follower.following_user_id = tweet.user_id INNER JOIN user ON user.user_id = follower.following_user_id
    WHERE follower.follower_user_id=${user_id}
    ORDER BY date_time DESC
    LIMIT 4 ;`
  const tweet = await db.all(getTweetsQuery)
  response.send(tweet)
})

app.get('/user/following/', authenticate, async (request, response) => {
  let {username} = request
  console.log(username)
  const getUserId = `SELECT * FROM user WHERE username ='${username}';`
  const userId = await db.get(getUserId)
  const {user_id} = userId

  const getNameQuery = `
    SELECT name
    FROM
     follower INNER JOIN  user ON user.user_id = follower.following_user_id
    WHERE
    follower.follower_user_id = ${user_id};`
  const followName = await db.all(getNameQuery)
  response.send(followName)
})

app.get('/user/followers/', authenticate, async (request, response) => {
  let {username} = request
  const getUserId = `SELECT * FROM user WHERE username ='${username}';`
  const userId = await db.get(getUserId)
  const {user_id} = userId
  const getNameQuery = `
    SELECT name
    FROM
     follower INNER JOIN  user ON user.user_id = follower.follower_user_id
    WHERE
     follower.following_user_id = ${user_id};`
  const followName = await db.all(getNameQuery)
  response.send(followName)
})

app.get('/tweets/:tweetId/', authenticate, async (request, response) => {
  const {tweetId} = request.params
  const getTweetById = `SELECT * FROM tweet WHERE tweet_id = ${tweetId};`
  const tweetDetails = await db.get(getTweetById)

  let {username} = request
  const getUserById = `SELECT * FROM user WHERE username ='${username}';`
  const userId = await db.get(getUserById)
  const {user_id} = userId
  const getFollowQuery = `
    SELECT *
    FROM
     follower INNER JOIN  user ON user.user_id = follower.following_user_id
    WHERE
     follower.follower_user_id = ${user_id};`
  const followUser = await db.all(getFollowQuery)

  if (
    followUser.some(items => items.following_user_id === tweetDetails.user_id)
  ) {
    const getTweetDetailsQuery = `
      SELECT
        tweet,
        COUNT(DISTINCT(like.like_id)) AS likes,
        COUNT(DISTINCT(reply.reply_id)) AS replies,
        tweet.date_time AS dateTime
      FROM
        tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id INNER JOIN reply ON reply.tweet_id = tweet.tweet_id
      WHERE
        tweet.tweet_id = ${tweetId} AND tweet.user_id = ${followUser[0].user_id};`

    const tweetsDetail = await db.get(getTweetDetailsQuery)
    response.send(tweetsDetail)
  } else {
    response.status(401)
    response.send('Invalid Request')
  }
})

app.get('/tweets/:tweetId/likes/', authenticate, async (request, response) => {
  const {tweetId} = request.params

  let {username} = request
  const getUserById = `SELECT * FROM user WHERE username ='${username}';`
  const userId = await db.get(getUserById)
  const {user_id} = userId

  const getLikeQuery = `
    SELECT *
    FROM
     follower INNER JOIN  tweet ON tweet.user_id = follower.following_user_id
     INNER JOIN  like ON like.tweet_id = tweet.tweet_id
     INNER JOIN  user ON user.user_id = like.user_id
    WHERE
     tweet.tweet_id = ${tweetId} AND follower.follower_user_id = ${user_id};`
  const likeUser = await db.all(getLikeQuery)

  if (likeUser.length !== 0) {
    let likes = []
    const getNamesArray = likeUser => {
      for (let item of likeUser) {
        likes.push(item.username)
      }
    }
    getNamesArray(likeUser)
    response.send({likes})
  } else {
    response.status(401)
    response.send('Invalid Request')
  }
})

app.get(
  '/tweets/:tweetId/replies/',
  authenticate,
  async (request, response) => {
    const {tweetId} = request.params

    let {username} = request
    const getUserById = `SELECT * FROM user WHERE username ='${username}';`
    const userId = await db.get(getUserById)
    const {user_id} = userId

    const getReplyQuery = `
    SELECT *
    FROM
     follower INNER JOIN  tweet ON tweet.user_id = follower.following_user_id
     INNER JOIN  reply ON reply.tweet_id = tweet.tweet_id
     INNER JOIN  user ON user.user_id = reply.user_id
    WHERE
     tweet.tweet_id = ${tweetId} AND follower.follower_user_id = ${user_id};`
    const replyUser = await db.all(getReplyQuery)

    if (replyUser.length !== 0) {
      let replies = []
      const getNamesArray = replyUser => {
        for (let item of replyUser) {
          let obj = {
            name: item.name,
            reply: item.reply,
          }
          replies.push(obj)
        }
      }
      getNamesArray(replyUser)
      response.send({replies})
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

app.get('/user/tweets/', authenticate, async (request, response) => {
  let {username} = request

  const getUserId = `SELECT * FROM user WHERE username ='${username}';`
  const userId = await db.get(getUserId)
  const {user_id} = userId

  const getTweetsQuery = `
    SELECT 
      tweet.tweet AS tweet,
      COUNT(DISTINCT(like.like_id)) AS likes,
      COUNT(DISTINCT(reply.reply_id)) AS replies,
      tweet.date_time AS dateTime
    FROM 
      user INNER JOIN tweet ON user.user_id = tweet.user_id 
      INNER JOIN like ON like.tweet_id = tweet.tweet_id
      INNER JOIN reply ON reply.tweet_id = tweet.tweet_id
    WHERE
      user.user_id = ${user_id} 
    GROUP BY 
      tweet.tweet_id;`
  const tweet = await db.all(getTweetsQuery)
  response.send(tweet)
})

app.post('/user/tweets/', authenticate, async (request, response) => {
  let {username} = request
  const {tweet} = request.body

  const getUserId = `SELECT * FROM user WHERE username ='${username}';`
  const userId = await db.get(getUserId)
  const {user_id} = userId

  const addTweetsQuery = `
    INSERT INTO
      tweet(tweet, user_id)
    VALUES(
      '${tweet}',
      ${user_id}
    );`
  await db.run(addTweetsQuery)
  response.send('Created a Tweet')
})

app.delete('/tweets/:tweetId/', authenticate, async (request, response) => {
  const {tweetId} = request.params

  let {username} = request
  const getUserById = `SELECT * FROM user WHERE username ='${username}';`
  const userId = await db.get(getUserById)
  const {user_id} = userId

  const getUserQuery = `
    SELECT *
    FROM
     tweet
    WHERE
     tweet.user_id = ${user_id} AND tweet.tweet_id = ${tweetId};`
  const tweetUser = await db.all(getUserQuery)

  if (tweetUser.length !== 0) {
    const delTweetQuery = `
          DELETE FROM
            tweet
          WHERE
            tweet.user_id = ${user_id} AND tweet.tweet_id = ${tweetId};`
    await db.all(delTweetQuery)
    response.send('Tweet Removed')
  } else {
    response.status(401)
    response.send('Invalid Request')
  }
})

module.exports = app
