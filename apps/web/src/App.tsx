import { packageName } from "@discussion-room/domain";

export const App = () => (
  <main>
    <h1>Discussion Room</h1>
    <p>
      domain package: <code>{packageName}</code>
    </p>
  </main>
);
