function GetCookies() {
  var cookies = {};
  var cookieStr = document.cookie.split('; ');
  cookieStr.forEach(function(element){
    var kv = element.split('=');
    cookies[kv[0]] = kv[1];
  });
  return cookies;
}
