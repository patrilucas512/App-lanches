const environment=process.env.TEST_ENVIRONMENT||"";
const target=process.env.TEST_BASE_URL||"";
const production=process.env.PRODUCTION_BASE_URL||"https://mesa-viva-patrilucas.patricklucas512.chatgpt.site";
if(!["development","staging"].includes(environment))throw new Error("TEST_ENVIRONMENT must be development or staging.");
if(!target)throw new Error("TEST_BASE_URL is required.");
if(new URL(target).origin===new URL(production).origin)throw new Error("Automated tests cannot target production.");
if(process.env.SUPABASE_PROJECT_ID&&process.env.PRODUCTION_SUPABASE_PROJECT_ID===process.env.SUPABASE_PROJECT_ID)throw new Error("Staging cannot use the production Supabase project.");
console.log(`Safe test target confirmed: ${environment}`);

