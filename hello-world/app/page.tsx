export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <main className="flex flex-col items-center justify-center px-6 py-12 text-center">
        {/* Hello World Heading */}
        <h1 className="mb-6 text-7xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-8xl md:text-9xl">
          Hello World
        </h1>
        
        {/* Subtitle */}
        <p className="mb-8 max-w-2xl text-xl text-gray-600 dark:text-gray-300 sm:text-2xl">
          Welcome to your Next.js application
        </p>
        
        {/* Decorative Divider */}
        <div className="mb-8 h-1 w-24 rounded-full bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500"></div>
        
      </main>
    </div>
  );
}
