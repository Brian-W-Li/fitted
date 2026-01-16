import Head from 'next/head'
import styles from '../styles/Home.module.css'

export default function Home() {
  return (
    <div className={styles.container}>
      <Head>
        <title>Hello World - Outfit Recommender</title>
        <meta name="description" content="Hello World app" />
      </Head>

      <main className={styles.main}>
        <h1 className={styles.title}>Hello World!</h1>
        <p className={styles.description}>
          Welcome to the Outfit Recommender app
        </p>
        <p className={styles.author}>By Jenil Prajapati</p>
      </main>
    </div>
  )
}

