<?php
declare(strict_types=1);
ini_set('display_errors','0');
if(PHP_SAPI!=='cli')header('X-Frame-Options: SAMEORIGIN');
date_default_timezone_set('Europe/Istanbul');
define('APP_ROOT', dirname(__DIR__));
function envv(string $key, string $fallback=''): string {static $data=null;if($data===null){$data=[];foreach(@file(APP_ROOT.'/.env',FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES)?:[] as $line){if(str_starts_with(trim($line),'#')||!str_contains($line,'='))continue;[$k,$v]=explode('=',$line,2);$data[trim($k)]=trim($v," \t\n\r\0\x0B\"");}}return (string)(getenv($key)?:($data[$key]??$fallback));}
// Public Google Web Client ID; hosting configuration overrides this default.
function googleClientId():string{return envv('GOOGLE_CLIENT_ID','757047488858-6f5hf7t87uqajnqetls551ljbook2c2h.apps.googleusercontent.com');}
require_once __DIR__.'/assistant-brand.php';
require_once __DIR__.'/branding.php';
require_once __DIR__.'/inventory.php';
require_once __DIR__.'/collections.php';
require_once __DIR__.'/regular-delivery.php';
require_once __DIR__.'/regular-offers.php';
function db(): PDO {static $db=null;if($db)return $db;$driver=envv('DB_DRIVER','mysql');if($driver==='sqlite'){$db=new PDO('sqlite:'.envv('DB_SQLITE_PATH',APP_ROOT.'/storage/store.sqlite'));$db->exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');}else{$host=envv('MYSQL_HOST');if(!$host)throw new RuntimeException('Veritabanı sunucusu ayarlanmamış.');$db=new PDO('mysql:host='.$host.';port='.envv('MYSQL_PORT','3306').';dbname='.envv('MYSQL_DATABASE').';charset=utf8mb4',envv('MYSQL_USER'),envv('MYSQL_PASSWORD'));}$db->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);$db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE,PDO::FETCH_ASSOC);$db->setAttribute(PDO::ATTR_EMULATE_PREPARES,false);return $db;}
function sql(string $sql,array $args=[]): PDOStatement{$q=db()->prepare($sql);$q->execute($args);return $q;}
function jsonval(mixed $v): string{return json_encode($v,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);}
function records(string $kind): array{if($kind==='settings'){$store=record('settings','store');return $store===null?[]:[$store];}$q=sql('SELECT payload FROM records WHERE kind=? ORDER BY position,id',[$kind]);return array_map(fn($x)=>json_decode($x['payload'],true,512,JSON_THROW_ON_ERROR),$q->fetchAll());}
function record(string $kind,string $id): ?array{if($kind==='settings'&&$id==='store')recoverLegacyStoreSettings();$x=sql('SELECT payload FROM records WHERE kind=? AND id=?',[$kind,$id])->fetchColumn();return $x===false?null:json_decode($x,true,512,JSON_THROW_ON_ERROR);}
function put(string $kind,string $id,array $value,int $position=0):void{if(record($kind,$id)!==null)sql('UPDATE records SET payload=?,position=?,updated_at=? WHERE kind=? AND id=?',[jsonval($value),$position,date(DATE_ATOM),$kind,$id]);else sql('INSERT INTO records(kind,id,payload,position,updated_at) VALUES(?,?,?,?,?)',[$kind,$id,jsonval($value),$position,date(DATE_ATOM)]);}
// Repair settings saved under a package ID by the former settings-save bug.
// Keep both the misplaced record and a revision of the original store settings.
function legacyStoreSettingsCandidate(array $rows):?array{
 $storeTime=0;$candidate=null;$latest=0;
 foreach($rows as $row)if($row['id']==='store')$storeTime=strtotime($row['updated_at'])?:0;
 foreach($rows as $row){
  if(!preg_match('/^pkg-[a-f0-9]{16,32}$/',$row['id']))continue;
  $value=json_decode($row['payload'],true);$sections=$value['collections']['sections']??[];
  $time=strtotime($row['updated_at'])?:0;
  if(!is_array($value)||!is_array($sections)||!$sections||($sections[array_key_last($sections)]['id']??'')!==$row['id']||!is_array($value['shipping']??null))continue;
  if($time>$storeTime&&$time>$latest){$candidate=$row;$latest=$time;}
 }
 return $candidate;
}
function recoverLegacyStoreSettings():void{
 static $checked=false;if($checked)return;$checked=true;
 $query="SELECT id,payload,updated_at FROM records WHERE kind='settings' AND (id='store' OR id LIKE 'pkg-%')";
 if(!legacyStoreSettingsCandidate(sql($query)->fetchAll()))return;
 $ownTransaction=!db()->inTransaction();if($ownTransaction)db()->beginTransaction();
 try{
  if(envv('DB_DRIVER')!=='sqlite')sql("SELECT id FROM records WHERE kind='settings' AND id='store' FOR UPDATE");
  $rows=sql($query)->fetchAll();$candidate=legacyStoreSettingsCandidate($rows);
  if($candidate){
   $prior=null;foreach($rows as $row)if($row['id']==='store')$prior=json_decode($row['payload'],true);
   $revisionId=bin2hex(random_bytes(12));
   put('revisions',$revisionId,['id'=>$revisionId,'kind'=>'settings','target'=>'store','value'=>$prior,'date'=>date(DATE_ATOM),'source'=>$candidate['id'],'reason'=>'Paket kimliğiyle kaydedilen ayarların geri alınması']);
   put('settings','store',json_decode($candidate['payload'],true,512,JSON_THROW_ON_ERROR));bump();
  }
  if($ownTransaction)db()->commit();
 }catch(Throwable $e){if($ownTransaction&&db()->inTransaction())db()->rollBack();throw $e;}
}
function initDb():void{static $done=false;if($done)return;$done=true;$auto=envv('DB_DRIVER')==='sqlite'?'INTEGER PRIMARY KEY AUTOINCREMENT':'BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT';foreach([
 'CREATE TABLE IF NOT EXISTS records (kind VARCHAR(40) NOT NULL,id VARCHAR(100) NOT NULL,payload TEXT NOT NULL,position INTEGER NOT NULL DEFAULT 0,updated_at VARCHAR(40) NOT NULL,PRIMARY KEY(kind,id))',
 "CREATE TABLE IF NOT EXISTS users (id $auto,email VARCHAR(190) NOT NULL UNIQUE,password_hash VARCHAR(255),name VARCHAR(160) NOT NULL,role VARCHAR(30) NOT NULL,google_sub VARCHAR(100) UNIQUE,created_at VARCHAR(40) NOT NULL)",
 "CREATE TABLE IF NOT EXISTS audit_log (id $auto,user_id BIGINT,event VARCHAR(80) NOT NULL,detail TEXT NOT NULL,created_at VARCHAR(40) NOT NULL)",
 "CREATE TABLE IF NOT EXISTS inquiries (id $auto,name VARCHAR(160) NOT NULL,email VARCHAR(190) NOT NULL,topic VARCHAR(160) NOT NULL,body TEXT NOT NULL,status VARCHAR(30) NOT NULL DEFAULT 'new',created_at VARCHAR(40) NOT NULL)",
 'CREATE TABLE IF NOT EXISTS orders (id VARCHAR(80) PRIMARY KEY,user_id BIGINT,email VARCHAR(190) NOT NULL,customer_json TEXT NOT NULL,items_json TEXT NOT NULL,subtotal INTEGER NOT NULL,shipping INTEGER NOT NULL,total INTEGER NOT NULL,status VARCHAR(40) NOT NULL,payment_status VARCHAR(40) NOT NULL,tracking_json TEXT NOT NULL,created_at VARCHAR(40) NOT NULL,updated_at VARCHAR(40) NOT NULL)',
 "CREATE TABLE IF NOT EXISTS mail_queue (id $auto,event_key VARCHAR(190) NOT NULL UNIQUE,audience VARCHAR(30) NOT NULL,recipient VARCHAR(190) NOT NULL,subject VARCHAR(250) NOT NULL,body TEXT NOT NULL,status VARCHAR(30) NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,created_at VARCHAR(40) NOT NULL)",
 'CREATE TABLE IF NOT EXISTS rate_limits (bucket VARCHAR(128) PRIMARY KEY,hits INTEGER NOT NULL,expires INTEGER NOT NULL)'
 ] as $ddl)db()->exec($ddl);
 if(!record('meta','installed')){db()->beginTransaction();try{$seed=json_decode(file_get_contents(APP_ROOT.'/server/seed.json'),true,512,JSON_THROW_ON_ERROR);foreach($seed['MAYA_CATALOG'] as $i=>$p)put('products',$p['id'],$p,$i);put('settings','store',$seed['MAYA_DEFAULTS']);foreach([['id'=>'beyaz','name'=>'Beyaz Peynirler','active'=>true],['id'=>'kasar','name'=>'Kaşar Peynirleri','active'=>true],['id'=>'diger','name'=>'Diğer Peynirler','active'=>false]] as $i=>$c)put('categories',$c['id'],$c,$i);put('meta','installed',['version'=>1]);db()->commit();}catch(Throwable $e){db()->rollBack();throw $e;}}
}
function startSession():void{if(session_status()!==PHP_SESSION_ACTIVE){session_name('maya_session');session_set_cookie_params(['lifetime'=>0,'path'=>'/','secure'=>!empty($_SERVER['HTTPS'])&&$_SERVER['HTTPS']!=='off','httponly'=>true,'samesite'=>'Lax']);session_start();}if(!isset($_SESSION['csrf']))$_SESSION['csrf']=bin2hex(random_bytes(32));if(!isset($_SESSION['google_nonce']))$_SESSION['google_nonce']=bin2hex(random_bytes(24));}
function user(): ?array{if(!isset($_SESSION['uid']))return null;$r=sql('SELECT id,email,name,role FROM users WHERE id=?',[$_SESSION['uid']])->fetch();return $r?:null;}
function admin():array{$u=user();if(!$u||!in_array($u['role'],['owner','editor','operations'],true))respond(['error'=>'Yönetici girişi gerekli.'],401);return $u;}
function owner():array{$u=admin();if($u['role']!=='owner')respond(['error'=>'Bu işlem için yönetici yetkisi gerekli.'],403);return $u;}
function csrf():void{if(!hash_equals($_SESSION['csrf'],(string)($_SERVER['HTTP_X_CSRF_TOKEN']??'')))respond(['error'=>'Oturum doğrulaması geçersiz; sayfayı yenileyin.'],403);}
function respond(array $data,int $status=200):never{http_response_code($status);header('Content-Type: application/json; charset=utf-8');header('Cache-Control: no-store');echo jsonval($data);exit;}
function input():array{$r=json_decode(file_get_contents('php://input'),true);if(!is_array($r))respond(['error'=>'Geçersiz veri.'],400);return $r;}
function limit(string $prefix,int $max,int $seconds):void{$key=hash('sha256',$prefix.'|'.($_SERVER['REMOTE_ADDR']??'cli'));$now=time();$r=sql('SELECT * FROM rate_limits WHERE bucket=?',[$key])->fetch();if(!$r){sql('INSERT INTO rate_limits(bucket,hits,expires) VALUES(?,?,?)',[$key,1,$now+$seconds]);return;}if((int)$r['expires']<=$now){sql('UPDATE rate_limits SET hits=1,expires=? WHERE bucket=?',[$now+$seconds,$key]);return;}if((int)$r['hits']>=$max){$retry=max(1,(int)$r['expires']-$now);header('Retry-After: '.$retry);respond(['error'=>'Deneme sınırına ulaşıldı. '.(int)ceil($retry/60).' dakika sonra yeniden deneyin.','retryAfter'=>$retry],429);}sql('UPDATE rate_limits SET hits=hits+1 WHERE bucket=?',[$key]);}
function audit(string $event,array $details=[]):void{sql('INSERT INTO audit_log(user_id,event,detail,created_at) VALUES(?,?,?,?)',[user()['id']??null,$event,jsonval($details),date(DATE_ATOM)]);}
function enqueue(string $key,string $audience,string $recipient,string $subject,string $body):void{if(in_array($audience,['customer','business'],true)&&!str_starts_with($body,'MAYA_HTML:'))$body=notificationEmail($subject,$body,$key);if(sql('SELECT id FROM mail_queue WHERE event_key=?',[$key])->fetchColumn())return;sql('INSERT INTO mail_queue(event_key,audience,recipient,subject,body,created_at) VALUES(?,?,?,?,?,?)',[$key,$audience,$recipient,$subject,$body,date(DATE_ATOM)]);}
function notifyBusiness(string $key,string $subject,string $body):void{foreach(array_filter(array_map('trim',explode(',',envv('NOTIFY_EMAILS')))) as $i=>$to)if(filter_var($to,FILTER_VALIDATE_EMAIL))enqueue($key.'-business-'.$i,'business',$to,$subject,$body);}
function publicStore():array{$s=record('settings','store')??[];$allowed=['primary','accent','background','font','filters','shipping','badges','certificates','videoUrl','shippingFee','freeShipping','contact','story','hero','promotion','references','referenceSpeed','announcement','homeContent','homeGroups','navigationLabels','tax','companion'];$settings=array_intersect_key($s,array_flip($allowed));$settings['branding']=storeBranding($s);$settings['assistantBrand']=assistantBrandFacts(is_array($s['assistantBrand']??null)?$s['assistantBrand']:[]);$products=array_values(array_filter(records('products'),fn($p)=>($p['active']??false)===true));$settings['collections']=collectionPageSettings(is_array($s['collections']??null)?$s['collections']:[],$products);foreach($settings['collections']['sections'] as &$section)$section['bundle']=bundleFromSection($section,$products);unset($section);return ['products'=>$products,'settings'=>$settings,'categories'=>array_values(array_filter(records('categories'),fn($c)=>$c['active']??false)),'pages'=>array_values(array_filter(records('pages'),fn($p)=>($p['active']??false)===true)),'campaigns'=>array_values(array_filter(records('campaigns'),fn($c)=>($c['active']??false)&&empty($c['deleted']))),'popups'=>array_values(array_filter(records('popups'),fn($p)=>$p['active']??false)),'crossSell'=>array_values(array_filter(records('cross_sell'),fn($p)=>$p['active']??false)),'googleClientId'=>googleClientId(),'googleNonce'=>$_SESSION['google_nonce'],'revision'=>record('meta','revision')['value']??1,'csrf'=>$_SESSION['csrf'],'membership'=>membershipDocuments(),'customer'=>user()&&user()['role']==='customer'?user():null];}
function bump():void{put('meta','revision',['value'=>(int)(record('meta','revision')['value']??1)+1]);}
function logError(Throwable $e):void{error_log($e->getMessage());file_put_contents(APP_ROOT.'/storage/error.log',date(DATE_ATOM).' '.get_class($e).' '.$e->getMessage()."\n",FILE_APPEND|LOCK_EX);}
require_once __DIR__.'/membership.php';
initDb();
// Hosting dosyasıyla yetkilendirilmiş, bir kez çalışan teslim düzeltmesi.
if(is_file(APP_ROOT.'/server/delivery-update.php'))require APP_ROOT.'/server/delivery-update.php';

require_once __DIR__.'/page-catalog.php';

require_once __DIR__.'/routing.php';
