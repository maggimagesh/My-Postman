// Postman's dynamic variables ({{$guid}}, {{$isoTimestamp}}, {{$randomEmail}} …).
// Classic script: loaded by index.html and importScripts()'d by the script sandbox, so both share one list.
(() => {
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const n = (k, f) => Array.from({ length: k }, f);
  const hex = k => [...crypto.getRandomValues(new Uint8Array(k))].map(b => b.toString(16).padStart(2, '0')).join('');
  const cap = s => s[0].toUpperCase() + s.slice(1);
  const iso = off => new Date(Date.now() + off).toISOString();
  const W = {
    first: ['Ava', 'Liam', 'Mia', 'Noah', 'Zara', 'Arjun', 'Priya', 'Kenji', 'Lucia', 'Omar', 'Elena', 'Kofi', 'Sara', 'Ivan', 'Maya', 'Leo', 'Nora', 'Ravi', 'Chloe', 'Mateo'],
    last: ['Smith', 'Patel', 'Kim', 'Garcia', 'Nguyen', 'Silva', 'Khan', 'Rossi', 'Muller', 'Okafor', 'Tanaka', 'Kumar', 'Lopez', 'Brown', 'Ivanova', 'Haddad'],
    lorem: 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim minim veniam quis nostrud exercitation ullamco laboris nisi aliquip commodo consequat'.split(' '),
    noun: ['system', 'array', 'protocol', 'driver', 'bandwidth', 'matrix', 'circuit', 'firewall', 'pixel', 'sensor', 'card', 'monitor', 'feed', 'panel', 'interface', 'microchip'],
    verb: ['parse', 'compress', 'navigate', 'connect', 'override', 'index', 'synthesize', 'bypass', 'calculate', 'quantify', 'transmit', 'program', 'reboot', 'hack', 'copy', 'generate'],
    adj: ['open-source', 'virtual', 'wireless', 'digital', 'mobile', 'neural', 'optical', 'redundant', 'primary', 'solid state', 'cross-platform', 'haptic', 'bluetooth', 'online', 'back-end', 'auxiliary'],
    city: ['Chennai', 'Berlin', 'Austin', 'Lagos', 'Osaka', 'Lisbon', 'Toronto', 'Sydney', 'Pune', 'Nairobi', 'Lima', 'Oslo', 'Seoul', 'Cairo'],
    country: [['India', 'IN'], ['Germany', 'DE'], ['United States', 'US'], ['Nigeria', 'NG'], ['Japan', 'JP'], ['Portugal', 'PT'], ['Canada', 'CA'], ['Australia', 'AU'], ['Brazil', 'BR'], ['Kenya', 'KE']],
    street: ['Main', 'Oak', 'Lake', 'Hill', 'Park', 'Cedar', 'Elm', 'River', 'Sunset', 'Maple'],
    currency: [['USD', 'US Dollar', '$'], ['EUR', 'Euro', '€'], ['INR', 'Indian Rupee', '₹'], ['JPY', 'Yen', '¥'], ['GBP', 'Pound Sterling', '£'], ['AUD', 'Australian Dollar', 'A$']],
    product: ['Chair', 'Car', 'Computer', 'Keyboard', 'Mouse', 'Bike', 'Ball', 'Gloves', 'Pants', 'Shirt', 'Table', 'Shoes', 'Hat', 'Towels', 'Soap', 'Tuna'],
    material: ['Steel', 'Wooden', 'Concrete', 'Plastic', 'Cotton', 'Granite', 'Rubber', 'Metal', 'Soft', 'Fresh', 'Frozen'],
    prodAdj: ['Small', 'Ergonomic', 'Rustic', 'Intelligent', 'Gorgeous', 'Incredible', 'Fantastic', 'Practical', 'Sleek', 'Awesome', 'Generic', 'Handcrafted'],
    dept: ['Books', 'Movies', 'Music', 'Games', 'Electronics', 'Computers', 'Home', 'Garden', 'Tools', 'Grocery', 'Health', 'Beauty', 'Toys', 'Kids', 'Sports', 'Outdoors'],
    jobArea: ['Solutions', 'Program', 'Brand', 'Security', 'Research', 'Marketing', 'Directives', 'Implementation', 'Integration', 'Functionality', 'Response', 'Paradigm'],
    jobDesc: ['Lead', 'Senior', 'Direct', 'Corporate', 'Dynamic', 'Future', 'Product', 'National', 'Regional', 'District', 'Central', 'Global', 'Customer', 'Investor', 'Principal'],
    jobType: ['Supervisor', 'Associate', 'Executive', 'Liaison', 'Officer', 'Manager', 'Engineer', 'Specialist', 'Director', 'Coordinator', 'Administrator', 'Architect', 'Analyst', 'Designer', 'Planner', 'Developer'],
    bsAdj: ['clicks-and-mortar', 'value-added', 'vertical', 'proactive', 'robust', 'revolutionary', 'scalable', 'leading-edge', 'innovative', 'intuitive', 'strategic', 'e-business'],
    bsBuzz: ['synergize', 'strategize', 'empower', 'leverage', 'incubate', 'unleash', 'orchestrate', 'deploy', 'streamline', 'monetize', 'disintermediate', 'scale'],
    bsNoun: ['synergies', 'paradigms', 'markets', 'partnerships', 'infrastructures', 'platforms', 'initiatives', 'channels', 'communities', 'solutions', 'e-tailers', 'web-readiness'],
    cpAdj: ['Adaptive', 'Advanced', 'Automated', 'Balanced', 'Centralized', 'Cloned', 'Configurable', 'Cross-group', 'Customizable', 'Decentralized', 'Distributed', 'Ergonomic'],
    cpDesc: ['24 hour', 'asymmetric', 'bifurcated', 'clear-thinking', 'context-sensitive', 'dedicated', 'directional', 'dynamic', 'executive', 'fault-tolerant', 'global', 'heuristic'],
    cpNoun: ['ability', 'access', 'adapter', 'algorithm', 'alliance', 'analyzer', 'application', 'approach', 'architecture', 'archive', 'artificial intelligence', 'attitude'],
    fileExt: [['pdf', 'application/pdf'], ['json', 'application/json'], ['png', 'image/png'], ['jpg', 'image/jpeg'], ['mp4', 'video/mp4'], ['txt', 'text/plain'], ['csv', 'text/csv'], ['zip', 'application/zip'], ['mp3', 'audio/mpeg'], ['html', 'text/html']],
    weekday: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    month: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  };
  const word = () => pick(W.lorem);
  const sentence = () => cap(n(rint(6, 11), word).join(' ')) + '.';
  const paragraph = () => n(3, sentence).join(' ');
  const domainWord = () => pick([...W.noun, ...W.lorem]).replace(/\s/g, '');
  const domainSuffix = () => pick(['com', 'net', 'org', 'io', 'info', 'biz', 'name']);
  const userName = () => `${pick(W.first)}${pick(['.', '_', ''])}${pick(W.last)}${rint(0, 99)}`;
  const company = () => `${pick(W.last)} ${pick(['Inc', 'LLC', 'Group', 'and Sons', 'Labs'])}`;
  const img = topic => () => `http://loremflickr.com/640/480/${topic}`;
  const fileExt = () => pick(W.fileExt);
  const fileName = () => `${word()}_${word()}.${fileExt()[0]}`;
  const D = {
    // common
    $guid: () => crypto.randomUUID(), $timestamp: () => String(Math.floor(Date.now() / 1000)), $isoTimestamp: () => new Date().toISOString(),
    $randomUUID: () => crypto.randomUUID(),
    // text, numbers, colors
    $randomAlphaNumeric: () => pick('abcdefghijklmnopqrstuvwxyz0123456789'), $randomBoolean: () => String(Math.random() < 0.5), $randomInt: () => String(rint(0, 1000)),
    $randomColor: () => pick(['red', 'green', 'blue', 'teal', 'orange', 'purple', 'cyan', 'magenta', 'lime', 'salmon']), $randomHexColor: () => '#' + hex(3),
    $randomAbbreviation: () => pick(['SQL', 'PCI', 'JSON', 'XML', 'HTTP', 'SMTP', 'TCP', 'RAM', 'SSL', 'CSS', 'API', 'SAS']),
    // internet / IP
    $randomIP: () => n(4, () => rint(1, 254)).join('.'), $randomIPV6: () => hex(16).match(/.{4}/g).join(':'), $randomMACAddress: () => hex(6).match(/.{2}/g).join(':'),
    $randomPassword: () => hex(8), $randomLocale: () => pick(['en', 'de', 'fr', 'ja', 'hi', 'ta', 'es', 'pt_BR', 'zh_CN']),
    $randomUserAgent: () => pick(['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15']),
    $randomProtocol: () => pick(['http', 'https']), $randomSemver: () => `${rint(0, 9)}.${rint(0, 9)}.${rint(0, 9)}`,
    // names
    $randomFirstName: () => pick(W.first), $randomLastName: () => pick(W.last), $randomFullName: () => `${pick(W.first)} ${pick(W.last)}`,
    $randomNamePrefix: () => pick(['Mr.', 'Mrs.', 'Ms.', 'Miss', 'Dr.']), $randomNameSuffix: () => pick(['Jr.', 'Sr.', 'I', 'II', 'III', 'IV', 'V', 'MD', 'DDS', 'PhD']),
    // profession
    $randomJobArea: () => pick(W.jobArea), $randomJobDescriptor: () => pick(W.jobDesc), $randomJobType: () => pick(W.jobType),
    $randomJobTitle: () => `${pick(W.jobDesc)} ${pick(W.jobArea)} ${pick(W.jobType)}`,
    // phone, address, location
    $randomPhoneNumber: () => `${rint(200, 999)}-${rint(200, 999)}-${rint(1000, 9999)}`, $randomPhoneNumberExt: () => `${rint(1, 99)}-${rint(200, 999)}-${rint(200, 999)}-${rint(1000, 9999)}`,
    $randomCity: () => pick(W.city), $randomStreetName: () => `${pick(W.street)} ${pick(['Street', 'Avenue', 'Road', 'Lane', 'Drive'])}`,
    $randomStreetAddress: () => `${rint(1, 9999)} ${pick(W.street)} ${pick(['Street', 'Avenue', 'Road', 'Lane', 'Drive'])}`,
    $randomCountry: () => pick(W.country)[0], $randomCountryCode: () => pick(W.country)[1],
    $randomLatitude: () => (Math.random() * 180 - 90).toFixed(4), $randomLongitude: () => (Math.random() * 360 - 180).toFixed(4),
    // images
    $randomAvatarImage: () => `https://i.pravatar.cc/150?u=${hex(4)}`, $randomImageUrl: img('all'), $randomAbstractImage: img('abstract'), $randomAnimalsImage: img('animals'),
    $randomBusinessImage: img('business'), $randomCatsImage: img('cats'), $randomCityImage: img('city'), $randomFoodImage: img('food'), $randomNightlifeImage: img('nightlife'),
    $randomFashionImage: img('fashion'), $randomPeopleImage: img('people'), $randomNatureImage: img('nature'), $randomSportsImage: img('sports'), $randomTransportImage: img('transport'),
    $randomImageDataUri: () => 'data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22100%22%20height%3D%22100%22%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22grey%22%2F%3E%3C%2Fsvg%3E',
    // finance
    $randomBankAccount: () => String(rint(10000000, 99999999)), $randomBankAccountName: () => pick(['Home Loan Account', 'Checking Account', 'Savings Account', 'Credit Card Account', 'Investment Account']),
    $randomCreditCardMask: () => String(rint(1000, 9999)), $randomBankAccountBic: () => `${hex(2).toUpperCase()}${pick(W.country)[1]}${hex(1).toUpperCase()}${rint(10, 99)}`,
    $randomBankAccountIban: () => `${pick(W.country)[1]}${rint(10, 99)}${n(4, () => rint(1000, 9999)).join('')}`, $randomTransactionType: () => pick(['invoice', 'payment', 'deposit', 'withdrawal']),
    $randomCurrencyCode: () => pick(W.currency)[0], $randomCurrencyName: () => pick(W.currency)[1], $randomCurrencySymbol: () => pick(W.currency)[2],
    $randomBitcoin: () => '1' + n(33, () => pick('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz')).join(''),
    // business
    $randomCompanyName: company, $randomCompanySuffix: () => pick(['Inc', 'LLC', 'Group', 'and Sons']),
    $randomBs: () => `${pick(W.bsBuzz)} ${pick(W.bsAdj)} ${pick(W.bsNoun)}`, $randomBsAdjective: () => pick(W.bsAdj), $randomBsBuzz: () => pick(W.bsBuzz), $randomBsNoun: () => pick(W.bsNoun),
    $randomCatchPhrase: () => `${pick(W.cpAdj)} ${pick(W.cpDesc)} ${pick(W.cpNoun)}`, $randomCatchPhraseAdjective: () => pick(W.cpAdj), $randomCatchPhraseDescriptor: () => pick(W.cpDesc), $randomCatchPhraseNoun: () => pick(W.cpNoun),
    // database
    $randomDatabaseColumn: () => pick(['id', 'title', 'name', 'email', 'phone', 'token', 'group', 'category', 'password', 'comment', 'avatar', 'status', 'createdAt', 'updatedAt']),
    $randomDatabaseType: () => pick(['int', 'varchar', 'text', 'date', 'datetime', 'boolean', 'json', 'uuid', 'bigint', 'decimal']),
    $randomDatabaseCollation: () => pick(['utf8_unicode_ci', 'utf8_general_ci', 'utf8_bin', 'ascii_bin', 'cp1250_bin', 'utf8mb4_0900_ai_ci']),
    $randomDatabaseEngine: () => pick(['InnoDB', 'MyISAM', 'MEMORY', 'CSV', 'BLACKHOLE', 'ARCHIVE']),
    // dates
    $randomDateFuture: () => iso(rint(1, 365) * 864e5), $randomDatePast: () => iso(-rint(1, 365) * 864e5), $randomDateRecent: () => iso(-rint(1, 2 * 864e5)),
    $randomWeekday: () => pick(W.weekday), $randomMonth: () => pick(W.month),
    // domains, emails, usernames
    $randomDomainName: () => `${domainWord()}.${domainSuffix()}`, $randomDomainSuffix: domainSuffix, $randomDomainWord: domainWord,
    $randomEmail: () => `${userName()}@${pick(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com'])}`, $randomExampleEmail: () => `${userName()}@example.${pick(['com', 'net', 'org'])}`,
    $randomUserName: userName, $randomUrl: () => `https://${domainWord()}.${domainSuffix()}`,
    // files and directories
    $randomFileName: fileName, $randomFileType: () => fileExt()[1].split('/')[0], $randomFileExt: () => fileExt()[0],
    $randomCommonFileName: fileName, $randomCommonFileType: () => fileExt()[1].split('/')[0], $randomCommonFileExt: () => fileExt()[0],
    $randomFilePath: () => `/${word()}/${word()}/${fileName()}`, $randomDirectoryPath: () => `/${word()}/${word()}`, $randomMimeType: () => fileExt()[1],
    // stores
    $randomPrice: () => (Math.random() * 1000).toFixed(2), $randomProduct: () => pick(W.product), $randomProductAdjective: () => pick(W.prodAdj), $randomProductMaterial: () => pick(W.material),
    $randomProductName: () => `${pick(W.prodAdj)} ${pick(W.material)} ${pick(W.product)}`, $randomDepartment: () => pick(W.dept),
    // grammar
    $randomNoun: () => pick(W.noun), $randomVerb: () => pick(W.verb), $randomIngverb: () => pick(W.verb).replace(/e$/, '') + 'ing', $randomAdjective: () => pick(W.adj),
    $randomWord: () => pick([...W.noun, ...W.verb, ...W.adj]), $randomWords: () => n(rint(2, 4), () => pick([...W.noun, ...W.verb, ...W.adj])).join(' '),
    $randomPhrase: () => `If we ${pick(W.verb)} the ${pick(W.noun)}, we can get to the ${pick(W.adj)} ${pick(W.noun)} through the ${pick(W.adj)} ${pick(W.noun)}!`,
    // lorem ipsum
    $randomLoremWord: word, $randomLoremWords: () => n(3, word).join(' '), $randomLoremSentence: sentence, $randomLoremSentences: () => n(rint(2, 6), sentence).join(' '),
    $randomLoremParagraph: paragraph, $randomLoremParagraphs: () => n(3, paragraph).join('\n'), $randomLoremText: () => n(rint(1, 3), sentence).join(' '),
    $randomLoremSlug: () => n(3, word).join('-'), $randomLoremLines: () => n(rint(1, 5), sentence).join('\n'),
  };
  // Resolves {{name}}: defined variables first, then Postman dynamic variables.
  // "{{isoTimestamp}}" (no $) also works when no variable of that name exists.
  const dynamicFor = k => D[k] || (!k.startsWith('$') && D['$' + k]) || null;
  const resolve = (s, vars) => String(s ?? '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, k) => {
    if (vars && Object.prototype.hasOwnProperty.call(vars, k) && vars[k] !== undefined) return vars[k];
    const f = dynamicFor(k);
    return f ? f() : m;
  });
  globalThis.MP_DYNAMIC = { vars: D, dynamicFor, resolve };
})();
